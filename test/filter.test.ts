import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildFilterPrompt, parseFilterResponse, filterJob } from '../lib/filter.ts';
import { writeFilterReport } from '../lib/filter-report.ts';
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

// ── FilterDecision-Rückgabewerte ─────────────────────────────────────────────

test('filterJob: match:true → outcome "matched"', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChat('{"match":true,"reason":"Junior-Stelle"}');
  t.after(close);

  const d = await filterJob(job, storage, url);
  assert.strictEqual(d.outcome, 'matched');
  assert.ok(d.reason.length > 0);
  assert.ok(d.job.title.length > 0);
});

test('filterJob: match:false → outcome "filtered_out", job-Daten erhalten', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChat('{"match":false,"reason":"Senior-Stelle"}');
  t.after(close);

  const d = await filterJob(job, storage, url);
  assert.strictEqual(d.outcome, 'filtered_out');
  assert.ok(d.reason.length > 0);
  assert.strictEqual(d.job.title, job.title);
  assert.strictEqual(d.job.url, job.url);
  // aus Storage gelöscht
  assert.strictEqual(await storage.get(job.id), null);
});

test('filterJob: Müll → outcome "skipped"', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChat('das ist kein JSON');
  t.after(close);

  const d = await filterJob(job, storage, url);
  assert.strictEqual(d.outcome, 'skipped');
  assert.ok(d.reason.length > 0);
});

// ── writeFilterReport ─────────────────────────────────────────────────────────

test('writeFilterReport: schreibt Datei mit Aussortiert + reason', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const reportPath = join(dir, 'filter-log.md');

  const job = sample();
  const decisions = [
    { job, outcome: 'filtered_out' as const, reason: 'Senior-Rolle, >3 Jahre', source: 'llm' as const },
    { job: { ...job, title: 'Frontend Dev' }, outcome: 'matched' as const, reason: 'Junior ok', source: 'llm' as const },
  ];

  writeFilterReport(decisions, reportPath);

  const content = readFileSync(reportPath, 'utf8');
  assert.ok(content.includes('Aussortiert'));
  assert.ok(content.includes('Senior-Rolle'));
  assert.ok(content.includes('Behalten'));
  assert.ok(content.includes('Frontend Dev'));
});

test('writeFilterReport: append-Modus (zwei Läufe → beide Header)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const reportPath = join(dir, 'filter-log.md');

  const job = sample();
  writeFilterReport([{ job, outcome: 'matched', reason: 'ok', source: 'llm' }], reportPath);
  writeFilterReport([{ job, outcome: 'matched', reason: 'ok', source: 'llm' }], reportPath);

  const content = readFileSync(reportPath, 'utf8');
  const matches = content.match(/## Filter-Lauf/g) ?? [];
  assert.strictEqual(matches.length, 2);
});
