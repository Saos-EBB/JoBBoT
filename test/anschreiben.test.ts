import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { buildAnschreibenPrompt, parseAnschreibenResponse, generateAnschreiben } from '../lib/anschreiben.ts';
import type { ProfileData } from '../lib/profile.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const sample = () => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title: 'Junior Softwareentwickler',
  company: 'Test GmbH',
  location: 'Linz',
  description: 'Wir suchen einen Junior Developer für unser Team in Linz.',
});

const profile: ProfileData = {
  name: 'Max Mustermann',
  job_title: 'Junior Softwareentwickler',
  quereinstieg: {
    bootcamp: 'TestBootcamp (6 Monate)',
    abschluss: 'HTL Informatik, Matura 2023',
    hintergrund: 'Quereinsteiger aus einem nicht-technischen Umfeld',
  },
  skills: {
    sprachen: ['TypeScript', 'Python'],
    frontend: ['React'],
    backend: ['Node.js'],
    datenbanken: ['SQL'],
    tools: ['Git'],
  },
  sprachkenntnisse: ['Deutsch (Muttersprache)', 'Englisch (B2)'],
  projekte: [{ name: 'TestBot', beschreibung: 'Automatisierungs-Tool in TypeScript.', tech: ['TypeScript'] }],
};

// kein "Sehr geehrte", kein "Mit freundlichen", keine Klammern, ≥ 50 Zeichen
const VALID_LETTER = `Die Kombination aus autonomer Robotik und praxisnaher Softwareentwicklung bei Test GmbH ist genau das Umfeld, in dem ich meine Kenntnisse einbringen möchte. Systeme, die in realen Produktionsumgebungen agieren, interessieren mich seit meiner Ausbildung.

Mit fundiertem Wissen in TypeScript und Node.js sowie SQL-Kenntnissen bringe ich die technische Basis mit, die für diese Junior-Stelle gefordert wird. Mein Praktikum hat gezeigt, dass ich Anforderungen strukturiert in lauffähigen Code umsetzen kann.

Ich freue mich auf ein Gespräch, in dem wir gemeinsam prüfen können, ob wir gut zusammenpassen.`;

function mockChat(content: string, onCall?: () => void): Promise<{ url: string; close: () => void }> {
  return new Promise(resolve => {
    const server = createServer((_, res) => {
      onCall?.();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

// ── pure ─────────────────────────────────────────────────────────────────────

test('buildAnschreibenPrompt: enthält title', () => {
  assert.ok(buildAnschreibenPrompt(sample(), profile).includes('Junior Softwareentwickler'));
});

test('buildAnschreibenPrompt: enthält Bewerbungs-Kontext', () => {
  const p = buildAnschreibenPrompt(sample(), profile).toLowerCase();
  assert.ok(p.includes('anschreiben') || p.includes('bewerbung') || p.includes('absatz'));
});

test('buildAnschreibenPrompt: description wird auf 1200 Zeichen begrenzt', () => {
  const longJob = { ...sample(), description: 'x'.repeat(2000) };
  const p = buildAnschreibenPrompt(longJob, profile);
  assert.ok(!p.includes('x'.repeat(1201)));
});

test('buildAnschreibenPrompt: enthält profile.quereinstieg.abschluss', () => {
  const p = buildAnschreibenPrompt(sample(), profile);
  assert.ok(p.includes(profile.quereinstieg.abschluss));
});

test('buildAnschreibenPrompt: enthält Absatz-Strukturhinweis', () => {
  const p = buildAnschreibenPrompt(sample(), profile);
  assert.ok(p.includes('Absatz'));
});

test('parseAnschreibenResponse: "   " → null', () => {
  assert.strictEqual(parseAnschreibenResponse('   '), null);
});

test('parseAnschreibenResponse: < 50 Zeichen → null', () => {
  assert.strictEqual(parseAnschreibenResponse('kurz'), null);
});

test('parseAnschreibenResponse: genau 50 Zeichen → string', () => {
  const s = 'x'.repeat(50);
  assert.strictEqual(parseAnschreibenResponse(s), s);
});

test('parseAnschreibenResponse: trimmt whitespace', () => {
  const s = '  ' + 'x'.repeat(50) + '  ';
  assert.strictEqual(parseAnschreibenResponse(s), 'x'.repeat(50));
});

test('parseAnschreibenResponse: Platzhalter [Dein Name] → null', () => {
  assert.strictEqual(parseAnschreibenResponse('[Dein Name] schreibt hier einen langen Text der mindestens fünfzig Zeichen hat'), null);
});

test('parseAnschreibenResponse: "Sehr geehrte" → null', () => {
  assert.strictEqual(parseAnschreibenResponse('Sehr geehrte Damen und Herren, ich bewerbe mich um die ausgeschriebene Stelle.'), null);
});

test('parseAnschreibenResponse: "Mit freundlichen" → null', () => {
  assert.strictEqual(parseAnschreibenResponse('Mit freundlichen Grüßen, Max Mustermann — das ist ein langer Abschlusstext.'), null);
});

test('parseAnschreibenResponse: valider Text ohne Floskeln → string', () => {
  const result = parseAnschreibenResponse(VALID_LETTER);
  assert.ok(typeof result === 'string' && result.length >= 50);
});

// ── generateAnschreiben mit mock ─────────────────────────────────────────────

test('generateAnschreiben: gültiger Response → status "generated", .md geschrieben', async (t) => {
  const dir = await tmpDir();
  const anschreibenDir = await tmpDir();
  t.after(() => { rmTmp(dir); rmTmp(anschreibenDir); });
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'matched' as const };
  await storage.save(job);

  const { url, close } = await mockChat(VALID_LETTER);
  t.after(close);

  const path = await generateAnschreiben(job, storage, profile, url, anschreibenDir);
  assert.strictEqual(job.status, 'generated');
  assert.ok(path !== null, 'expected path to be returned');
  assert.strictEqual((await storage.get(job.id))?.status, 'generated');
  const content = await readFile(path!, 'utf8');
  assert.ok(content.length >= 50);
});

test('generateAnschreiben: leerer Response → status bleibt "matched", path null', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'matched' as const };
  await storage.save(job);

  const { url, close } = await mockChat('');
  t.after(close);

  const path = await generateAnschreiben(job, storage, profile, url);
  assert.strictEqual(job.status, 'matched');
  assert.strictEqual(path, null);
});

test('generateAnschreiben: status "uncertain" → wird auch verarbeitet (nicht nur "matched")', async (t) => {
  const dir = await tmpDir();
  const anschreibenDir = await tmpDir();
  t.after(() => { rmTmp(dir); rmTmp(anschreibenDir); });
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'uncertain' as const };
  await storage.save(job);

  const { url, close } = await mockChat(VALID_LETTER);
  t.after(close);

  const path = await generateAnschreiben(job, storage, profile, url, anschreibenDir);
  assert.strictEqual(job.status, 'generated');
  assert.ok(path !== null, 'expected path to be returned');
});

test('generateAnschreiben: status !== "matched" → kein Ollama-Call', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample(); // status is 'new'
  await storage.save(job);

  let called = false;
  const { url, close } = await mockChat(VALID_LETTER, () => { called = true; });
  t.after(close);

  const path = await generateAnschreiben(job, storage, profile, url);
  assert.strictEqual(called, false);
  assert.strictEqual(job.status, 'new');
  assert.strictEqual(path, null);
});
