import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildFilterPrompt, buildMessages, parseFilterResponse, filterJob, decideJob, SYSTEM } from '../lib/filter.ts';
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

// liefert bei jedem Call den nächsten Eintrag aus `contents` (letzter wiederholt sich)
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

// ── pure ─────────────────────────────────────────────────────────────────────

test('buildFilterPrompt: enthält title', () => {
  const job = sample();
  assert.ok(buildFilterPrompt(job).includes(job.title));
});

test('buildFilterPrompt: enthält "junior" als Kriterium', () => {
  assert.ok(buildFilterPrompt(sample()).toLowerCase().includes('junior'));
});

test('buildFilterPrompt: HTML-Tags werden entfernt', () => {
  const job = { ...sample(), description: '<p>Wir suchen <strong>dich</strong>!</p>' };
  const p = buildFilterPrompt(job);
  assert.ok(!p.includes('<p>') && !p.includes('<strong>'));
  assert.ok(p.includes('Wir suchen') && p.includes('dich'));
});

test('SYSTEM: enthält match/reason JSON-Format', () => {
  assert.ok(SYSTEM.includes('match') && SYSTEM.includes('reason'));
});

test('buildMessages: system + finale user-message, kein Few-Shot', () => {
  const messages = buildMessages(sample());
  assert.strictEqual(messages[0].role, 'system');
  assert.strictEqual(messages.length, 2); // system + user, kein Few-Shot (siehe lib/filter.ts)
  assert.strictEqual(messages[1].role, 'user');
  assert.ok(messages[1].content.includes(sample().title));
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

// ── Retry ────────────────────────────────────────────────────────────────────

test('filterJob: 1. Call Müll, 2. Call valide → Retry greift, outcome korrekt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close, calls } = await mockChatSequence(['kein json', '{"match":true,"reason":"Retry hat geklappt"}']);
  t.after(close);

  const d = await filterJob(job, storage, url);
  assert.strictEqual(d.outcome, 'matched');
  assert.strictEqual(d.reason, 'Retry hat geklappt');
  assert.strictEqual(calls(), 2);
});

test('filterJob: 2× Müll → outcome "skipped", status bleibt "new", genau 2 Calls', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close, calls } = await mockChatSequence(['Müll 1', 'Müll 2']);
  t.after(close);

  const d = await filterJob(job, storage, url);
  assert.strictEqual(d.outcome, 'skipped');
  assert.strictEqual(job.status, 'new');
  assert.strictEqual(calls(), 2);
});

// ── decideJob (Titel-Vorfilter) ────────────────────────────────────────────────

test('decideJob: "Senior..."-Titel → per Regel aussortiert, KEIN Ollama-Call', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = toJob({
    source: 'karriere.at',
    url: 'https://www.karriere.at/jobs/999',
    title: 'Senior Fullstack Developer',
    company: 'Test GmbH',
    description: 'Wir suchen einen erfahrenen Senior Entwickler.',
  });
  await storage.save(job);

  let called = false;
  const server = createServer((_, res) => {
    called = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { content: '{"match":true,"reason":"sollte nie aufgerufen werden"}' } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  t.after(() => server.close());

  const d = await decideJob(job, storage, `http://127.0.0.1:${port}`);
  assert.strictEqual(d.outcome, 'filtered_out');
  assert.strictEqual(d.source, 'title-rule');
  assert.strictEqual(d.term, 'senior');
  assert.strictEqual(called, false);
  assert.strictEqual((await storage.get(job.id)), null);
});

test('decideJob: neutraler Titel → geht an filterJob (LLM)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChat('{"match":true,"reason":"Junior-Stelle"}');
  t.after(close);

  const d = await decideJob(job, storage, url);
  assert.strictEqual(d.outcome, 'matched');
  assert.strictEqual(d.source, 'llm');
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

test('writeFilterReport: trennt Titel-Regel- und LLM-Aussortierungen', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const reportPath = join(dir, 'filter-log.md');

  const job = sample();
  const decisions = [
    { job: { ...job, title: 'Senior Dev' }, outcome: 'filtered_out' as const, reason: "Titel-Ausschluss: 'senior'", source: 'title-rule' as const, term: 'senior' },
    { job, outcome: 'filtered_out' as const, reason: 'IT-Support, keine Entwicklerrolle', source: 'llm' as const },
  ];

  writeFilterReport(decisions, reportPath);
  const content = readFileSync(reportPath, 'utf8');
  assert.ok(content.includes('Aussortiert per Titel-Regel'));
  assert.ok(content.includes('Aussortiert per LLM'));
  assert.ok(content.includes("Begriff: 'senior'"));
  assert.ok(content.includes('IT-Support, keine Entwicklerrolle'));
});
