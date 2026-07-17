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

// liefert pro Aufruf die nächste Antwort aus `contents` (bleibt auf der letzten, wenn erschöpft)
function mockChatSequence(contents: string[]): Promise<{ url: string; close: () => void; calls: () => number }> {
  return new Promise(resolve => {
    let n = 0;
    const server = createServer((_, res) => {
      const content = contents[Math.min(n, contents.length - 1)];
      n++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), calls: () => n });
    });
  });
}

const EIN_ABSATZ = 'Das ist nur ein einziger Absatz ohne Zeilenumbruch, also ungültig laut Formel.';

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

test('parseAnschreibenResponse: 3 Absätze ≥ 50 Zeichen → string', () => {
  const s = 'x'.repeat(20) + '\n\n' + 'y'.repeat(20) + '\n\n' + 'z'.repeat(20);
  assert.strictEqual(parseAnschreibenResponse(s), s);
});

test('parseAnschreibenResponse: trimmt whitespace', () => {
  const inner = 'a'.repeat(20) + '\n\n' + 'b'.repeat(20) + '\n\n' + 'c'.repeat(20);
  const s = '  ' + inner + '  ';
  assert.strictEqual(parseAnschreibenResponse(s), inner);
});

test('parseAnschreibenResponse: nicht genau 3 Absätze → throws', () => {
  assert.throws(() => parseAnschreibenResponse('x'.repeat(60)), /Absatz-Anzahl/);
});

test('parseAnschreibenResponse: Verbotswort "motiviert" → throws', () => {
  const s = 'Erster Absatz mit genug Zeichen fuer den Test hier.\n\nZweiter Absatz ist auch lang genug an dieser Stelle.\n\nIch bin sehr motiviert und freue mich.';
  assert.throws(() => parseAnschreibenResponse(s), /Verbotswort/);
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
  const logDir = await tmpDir();
  t.after(() => { rmTmp(dir); rmTmp(anschreibenDir); rmTmp(logDir); });
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'triaged' as const, fit: 'matched' as const };
  await storage.save(job);

  const { url, close } = await mockChat(VALID_LETTER);
  t.after(close);

  const path = await generateAnschreiben(job, storage, profile, url, anschreibenDir, undefined, `${logDir}/log.md`);
  assert.ok(path !== null, 'expected path to be returned');
  assert.strictEqual((await storage.get(job.id))?.status, 'generated');
  const content = await readFile(path!, 'utf8');
  assert.ok(content.length >= 50);
});

test('generateAnschreiben: leerer Response → status bleibt "triaged", path null', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'triaged' as const, fit: 'matched' as const };
  await storage.save(job);

  const { url, close } = await mockChat('');
  t.after(close);

  const path = await generateAnschreiben(job, storage, profile, url);
  assert.strictEqual(job.status, 'triaged');
  assert.strictEqual(path, null);
});

test('generateAnschreiben: fit "offstack" → wird auch verarbeitet (nicht nur "matched")', async (t) => {
  const dir = await tmpDir();
  const anschreibenDir = await tmpDir();
  const logDir = await tmpDir();
  t.after(() => { rmTmp(dir); rmTmp(anschreibenDir); rmTmp(logDir); });
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'triaged' as const, fit: 'offstack' as const };
  await storage.save(job);

  const { url, close } = await mockChat(VALID_LETTER);
  t.after(close);

  const path = await generateAnschreiben(job, storage, profile, url, anschreibenDir, undefined, `${logDir}/log.md`);
  assert.strictEqual((await storage.get(job.id))?.status, 'generated');
  assert.ok(path !== null, 'expected path to be returned');
});

test('generateAnschreiben: status !== "triaged" → kein Ollama-Call', async (t) => {
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

// ── Regenerierung bei Absatz-/Verbotswort-Verstoß ───────────────────────────

test('generateAnschreiben: 1. Versuch ungültig (1 Absatz), 2. Versuch gültig → generiert', async (t) => {
  const dir = await tmpDir();
  const anschreibenDir = await tmpDir();
  const logDir = await tmpDir();
  t.after(() => { rmTmp(dir); rmTmp(anschreibenDir); rmTmp(logDir); });
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'triaged' as const, fit: 'matched' as const };
  await storage.save(job);

  const { url, close, calls } = await mockChatSequence([EIN_ABSATZ, VALID_LETTER]);
  t.after(close);

  const path = await generateAnschreiben(job, storage, profile, url, anschreibenDir, undefined, `${logDir}/log.md`);
  assert.strictEqual((await storage.get(job.id))?.status, 'generated');
  assert.ok(path !== null, 'expected path to be returned');
  assert.strictEqual(calls(), 2);
});

test('generateAnschreiben: dauerhaft ungültig → Regenerierungen erschöpft, skip + Log-Eintrag', async (t) => {
  const dir = await tmpDir();
  const logDir = await tmpDir();
  t.after(() => { rmTmp(dir); rmTmp(logDir); });
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'triaged' as const, fit: 'matched' as const };
  await storage.save(job);

  const { url, close, calls } = await mockChatSequence([EIN_ABSATZ]);
  t.after(close);

  const logPath = `${logDir}/anschreiben-skip.md`;
  const path = await generateAnschreiben(job, storage, profile, url, undefined, undefined, logPath);
  assert.strictEqual(path, null);
  assert.strictEqual(job.status, 'triaged');
  assert.strictEqual(calls(), 3); // 1 Versuch + 2 Regenerierungen

  const log = await readFile(logPath, 'utf8');
  assert.ok(log.includes(job.title));
  assert.ok(log.includes('Absatz-Anzahl'));
});
