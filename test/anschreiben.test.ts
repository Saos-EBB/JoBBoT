import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { buildAnschreibenPrompt, parseAnschreibenResponse, generateAnschreiben } from '../lib/anschreiben.ts';
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
  assert.ok(buildAnschreibenPrompt(sample()).includes('Junior Softwareentwickler'));
});

test('buildAnschreibenPrompt: enthält Bewerbungs-Kontext', () => {
  const p = buildAnschreibenPrompt(sample()).toLowerCase();
  assert.ok(p.includes('anschreiben') || p.includes('bewerbung'));
});

test('buildAnschreibenPrompt: description wird auf 1200 Zeichen begrenzt', () => {
  const longJob = { ...sample(), description: 'x'.repeat(2000) };
  const p = buildAnschreibenPrompt(longJob);
  // 'x'.repeat(1201) should not appear in prompt
  assert.ok(!p.includes('x'.repeat(1201)));
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

// ── generateAnschreiben mit mock ─────────────────────────────────────────────

const VALID_LETTER = 'Sehr geehrte Damen und Herren, ich bin begeistert von Ihrer Stelle als Junior Softwareentwickler und möchte mich vorstellen.';

test('generateAnschreiben: gültiger Response → status "generated", .md geschrieben', async (t) => {
  const dir = await tmpDir();
  const anschreibenDir = await tmpDir();
  t.after(() => { rmTmp(dir); rmTmp(anschreibenDir); });
  const storage = createStorage(dir);
  const job = { ...sample(), status: 'matched' as const };
  await storage.save(job);

  const { url, close } = await mockChat(VALID_LETTER);
  t.after(close);

  const path = await generateAnschreiben(job, storage, url, anschreibenDir);
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

  const path = await generateAnschreiben(job, storage, url);
  assert.strictEqual(job.status, 'matched');
  assert.strictEqual(path, null);
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

  const path = await generateAnschreiben(job, storage, url);
  assert.strictEqual(called, false);
  assert.strictEqual(job.status, 'new');
  assert.strictEqual(path, null);
});
