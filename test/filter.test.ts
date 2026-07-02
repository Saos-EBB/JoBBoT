import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { filterJob } from '../lib/filter.ts';
import type { FilterDecision } from '../lib/filter.ts';
import { writeFilterReport } from '../lib/filter-report.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const sample = (title = 'Junior Developer') => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title,
  company: 'Test GmbH',
  description: 'Anforderungen: TypeScript-Kenntnisse.',
});

const judgmentJson = (overrides: Record<string, string> = {}): string => JSON.stringify({
  it_rolle: 'ja',
  erfahrung_ab_3j_erforderlich: 'nein',
  lehre_coding: 'n/a',
  junior_signal: 'ja',
  ...overrides,
});

function mockChatSequence(contents: string[]): Promise<{ url: string; close: () => void; calls: () => number }> {
  let i = 0;
  let count = 0;
  return new Promise(resolve => {
    const server = createServer((_, res) => {
      count++;
      const content = contents[Math.min(i, contents.length - 1)];
      i++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), calls: () => count });
    });
  });
}

// ── filterJob mit mock Ollama ────────────────────────────────────────────────

test('filterJob: it_rolle ja, erfahrung nein, junior_signal ja → status "matched"', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChatSequence([judgmentJson()]);
  t.after(close);

  const d = await filterJob(job, storage, url, 'llama');
  assert.equal(d.status, 'matched');
  assert.equal((await storage.get(job.id))?.status, 'matched');
});

test('filterJob: it_rolle nein → status "filtered_out", Datei bleibt erhalten (kein delete)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChatSequence([judgmentJson({ it_rolle: 'nein' })]);
  t.after(close);

  const d = await filterJob(job, storage, url, 'llama');
  assert.equal(d.status, 'filtered_out');
  assert.equal(d.rejectedBy, 'IT-Rolle');
  // Retain: Datei existiert noch, nichts gelöscht
  const stored = await storage.get(job.id);
  assert.ok(stored !== null);
  assert.equal(stored?.status, 'filtered_out');
});

test('filterJob: Titel-Regel ("Senior...") → status "filtered_out", KEIN Ollama-Call, Datei bleibt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample('Senior Fullstack Developer');
  await storage.save(job);

  let called = false;
  const server = createServer((_, res) => {
    called = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { content: judgmentJson() } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  t.after(() => server.close());

  const d = await filterJob(job, storage, `http://127.0.0.1:${port}`, 'llama');
  assert.equal(d.status, 'filtered_out');
  assert.equal(d.rejectedBy, 'Seniorität (Titel)');
  assert.equal(called, false);
  assert.ok((await storage.get(job.id)) !== null);
});

test('filterJob: junior_signal nein → status "uncertain", Datei bleibt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChatSequence([judgmentJson({ junior_signal: 'nein' })]);
  t.after(close);

  const d = await filterJob(job, storage, url, 'llama');
  assert.equal(d.status, 'uncertain');
  assert.ok((await storage.get(job.id)) !== null);
});

test('filterJob: Regex-Modus, disqualifizierende Erfahrung → filtered_out, Datei bleibt (Retain)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample('Software Developer');
  job.description = 'Anforderungen: Mind. 3 Jahre Berufserfahrung erforderlich.';
  await storage.save(job);

  const d = await filterJob(job, storage, undefined, 'regex');
  assert.equal(d.status, 'filtered_out');
  assert.match(d.rejectedBy ?? '', /Erfahrung ≥3J/);
  const stored = await storage.get(job.id);
  assert.ok(stored !== null);
  assert.equal(stored?.status, 'filtered_out');
});

test('filterJob: 2× Müll → "uncertain" statt Absturz', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChatSequence(['Müll 1', 'Müll 2']);
  t.after(close);

  const d = await filterJob(job, storage, url, 'llama');
  assert.equal(d.status, 'uncertain');
});

// ── writeFilterReport ─────────────────────────────────────────────────────────

function decision(overrides: Partial<FilterDecision> & { job: ReturnType<typeof sample> }): FilterDecision {
  return {
    job: overrides.job,
    status: overrides.status ?? 'matched',
    rejectedBy: overrides.rejectedBy,
    judgment: overrides.judgment,
  };
}

test('writeFilterReport: drei Fächer mit Aggregat und Summenzeile', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const reportPath = join(dir, 'filter-log.md');
  const job = sample();

  const decisions: FilterDecision[] = [
    decision({ job, status: 'filtered_out', rejectedBy: 'Seniorität (Titel)' }),
    decision({
      job: { ...job, title: 'Frontend Dev' },
      status: 'uncertain',
      judgment: { it_rolle: 'unsicher', erfahrung_ab_3j_erforderlich: 'nein', lehre_coding: 'n/a', junior_signal: 'nein' },
    }),
    decision({ job: { ...job, title: 'Junior Dev' }, status: 'matched' }),
  ];

  writeFilterReport(decisions, reportPath);
  const content = readFileSync(reportPath, 'utf8');

  assert.ok(content.includes('### Aggregat'));
  assert.ok(content.includes('### Raus (1)'));
  assert.ok(content.includes('Grund: Seniorität (Titel)'));
  assert.ok(content.includes('### Unsicher (1)'));
  assert.ok(content.includes('Frontend Dev'));
  assert.ok(content.includes('it_rolle'));
  assert.ok(content.includes('### Sicher (1)'));
  assert.ok(content.includes('Junior Dev'));
  assert.ok(content.includes('1 sicher, 1 unsicher, 1 raus'));
});

test('writeFilterReport: append-Modus (zwei Läufe → beide Header)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const reportPath = join(dir, 'filter-log.md');
  const job = sample();

  writeFilterReport([decision({ job, status: 'matched' })], reportPath);
  writeFilterReport([decision({ job, status: 'matched' })], reportPath);

  const content = readFileSync(reportPath, 'utf8');
  const matches = content.match(/## Filter-Lauf/g) ?? [];
  assert.equal(matches.length, 2);
});
