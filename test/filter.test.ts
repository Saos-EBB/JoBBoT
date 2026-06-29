import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildFilterPrompt, parseFilterResponse, filterJob } from '../lib/filter.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const sample = () => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title: 'Junior Developer',
  company: 'Test GmbH',
  description: 'Wir suchen einen Junior Developer für unser Team.',
});

function mockChat(content: string): Promise<{ url: string; close: () => void }> {
  return new Promise(resolve => {
    const server = createServer((_, res) => {
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

test('buildFilterPrompt: enthält title', () => {
  const job = sample();
  assert.ok(buildFilterPrompt(job).includes(job.title));
});

test('buildFilterPrompt: enthält "junior" als Kriterium', () => {
  assert.ok(buildFilterPrompt(sample()).toLowerCase().includes('junior'));
});

test('buildFilterPrompt: enthält "match" und "reason"', () => {
  const p = buildFilterPrompt(sample());
  assert.ok(p.includes('match') && p.includes('reason'));
});

test('parseFilterResponse: match:true', () => {
  assert.deepEqual(parseFilterResponse('{"match":true,"reason":"passt"}'), { match: true, reason: 'passt' });
});

test('parseFilterResponse: match:false', () => {
  assert.deepEqual(parseFilterResponse('{"match":false,"reason":"Senior-Rolle"}'), { match: false, reason: 'Senior-Rolle' });
});

test('parseFilterResponse: kein JSON → null', () => {
  assert.strictEqual(parseFilterResponse('irgendein Text kein JSON'), null);
});

test('parseFilterResponse: "" → null', () => {
  assert.strictEqual(parseFilterResponse(''), null);
});

test('parseFilterResponse: reason fehlt → null', () => {
  assert.strictEqual(parseFilterResponse('{"match":true}'), null);
});

// ── filterJob mit mock ────────────────────────────────────────────────────────

test('filterJob: match:true → status "matched"', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChat('{"match":true,"reason":"Junior-Stelle"}');
  t.after(close);

  await filterJob(job, storage, url);
  assert.strictEqual(job.status, 'matched');
  assert.strictEqual((await storage.get(job.id))?.status, 'matched');
});

test('filterJob: match:false → status "filtered_out"', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChat('{"match":false,"reason":"Senior-Rolle"}');
  t.after(close);

  await filterJob(job, storage, url);
  assert.strictEqual(job.status, 'filtered_out');
});

test('filterJob: Ollama antwortet mit Müll → status bleibt "new"', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChat('das ist kein JSON');
  t.after(close);

  await filterJob(job, storage, url);
  assert.strictEqual(job.status, 'new');
});
