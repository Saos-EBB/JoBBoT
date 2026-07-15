import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { tmpDir, rmTmp } from './helpers.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';

function jobFiles(files: string[]) {
  return files.filter(f => f.endsWith('.json') && !f.startsWith('.'));
}

function fakeScraped(title = 'Test Dev', company = 'Testcorp'): ScrapedJob {
  return { source: 'smoke', url: 'https://example.com', title, company, description: 'desc' };
}

// ── Happy path ──────────────────────────────────────────────────────────────

test('save → exists true; unknown → exists false', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());

  await store.save(job);
  assert.equal(await store.exists(job.id), true);
  assert.equal(await store.exists('000000000000dead'), false);
});

test('get returns deep-equal job; unknown → null', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());

  await store.save(job);
  const fetched = await store.get(job.id);
  assert.deepEqual(fetched, job);
  assert.equal(await store.get('000000000000dead'), null);
});

test('list() returns all; list({status}) filters', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const j1 = toJob(fakeScraped('Dev A', 'Corp A'));
  const j2 = toJob(fakeScraped('Dev B', 'Corp B'));

  await store.save(j1);
  await store.save(j2);
  await store.updateStatus(j2.id, 'matched');

  assert.equal((await store.list()).length, 2);
  const matched = await store.list({ status: 'matched' });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, j2.id);
});

test('update merges, bumps updatedAt, keeps scrapedAt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  await store.save(job);

  await new Promise(r => setTimeout(r, 5)); // ensure clock advances
  const updated = await store.update(job.id, { status: 'matched' });

  assert.equal(updated.status, 'matched');
  assert.equal(updated.scrapedAt, job.scrapedAt);
  assert.ok(updated.updatedAt >= job.updatedAt);
});

test('updateStatus sets status correctly', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  await store.save(job);

  const updated = await store.updateStatus(job.id, 'gesendet');
  assert.equal(updated.status, 'gesendet');
});

// ── Dedup / Atomik ──────────────────────────────────────────────────────────

test('save same id twice → exactly one file', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());

  await store.save(job);
  await store.save(job);

  const files = await readdir(dir);
  assert.equal(jobFiles(files).length, 1);
});

test('no .tmp- leftovers after save', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  await store.save(toJob(fakeScraped()));

  const files = await readdir(dir);
  assert.equal(files.filter(f => f.startsWith('.tmp-')).length, 0);
});

// ── Ausfälle ────────────────────────────────────────────────────────────────

test('list() on non-existent dir → []', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(join(dir, 'does-not-exist'));

  const result = await store.list();
  assert.deepEqual(result, []);
});

test('corrupt JSON file → skipped, valid jobs returned', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  await store.save(job);

  await writeFile(join(dir, 'corrupt.json'), '{{{not json', 'utf8');

  const result = await store.list();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, job.id);
});

test('non-.json file in dir → ignored', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  await store.save(toJob(fakeScraped()));
  await writeFile(join(dir, 'notes.txt'), 'hello', 'utf8');

  const result = await store.list();
  assert.equal(result.length, 1);
});

test('update unknown id throws', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  await assert.rejects(() => store.update('000000000000dead', { status: 'gesendet' }));
});

test('updateStatus unknown id throws', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  await assert.rejects(() => store.updateStatus('000000000000dead', 'gesendet'));
});

// ── Nebenläufigkeit ─────────────────────────────────────────────────────────

test('concurrent saves of different ids → all persisted', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const jobs = Array.from({ length: 10 }, (_, i) => toJob(fakeScraped(`Dev ${i}`, `Corp ${i}`)));

  await Promise.all(jobs.map(j => store.save(j)));
  assert.equal((await store.list()).length, 10);
});

test('concurrent saves of same id → 1 file, valid JSON', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());

  await Promise.all(Array.from({ length: 8 }, () => store.save(job)));

  const files = jobFiles(await readdir(dir));
  assert.equal(files.length, 1);
  const content = await readFile(join(dir, files[0]), 'utf8');
  assert.doesNotThrow(() => JSON.parse(content));
});

// ── Isolation ───────────────────────────────────────────────────────────────

test('get() returns independent copy — mutation does not affect stored data', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  await store.save(job);

  const copy = await store.get(job.id);
  copy!.status = 'gesendet'; // mutate returned object

  const again = await store.get(job.id);
  assert.equal(again!.status, 'new'); // file unchanged
});

// ── Neues Naming ─────────────────────────────────────────────────────────────

test('save(job) → filename enthält slugified title + company', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped('Junior Developer', 'Test GmbH'));
  await store.save(job);

  const files = jobFiles(await readdir(dir));
  assert.ok(files[0]?.includes('junior-developer'), `filename: ${files[0]}`);
  assert.ok(files[0]?.includes('test-gmbh'), `filename: ${files[0]}`);
});

test('save(job) → filename endet auf _${id.slice(0,8)}.json', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  await store.save(job);

  const files = jobFiles(await readdir(dir));
  assert.ok(files[0]?.endsWith(`_${job.id.slice(0, 8)}.json`), `filename: ${files[0]}`);
});

test('exists(id) → true nach save', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  await store.save(job);
  assert.equal(await store.exists(job.id), true);
});

test('delete(id) → Datei weg danach', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  await store.save(job);
  await store.delete(job.id);
  assert.equal(await store.exists(job.id), false);
  assert.equal(jobFiles(await readdir(dir)).length, 0);
});

test('delete(nichtExistente id) → kein throw', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  await assert.doesNotReject(() => store.delete('000000000000dead'));
});

// ── Sortierte Unterordner sicher/unsicher ──────────────────────────────────

test('save(status=matched) → Datei landet in <dir>/sicher/', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  job.status = 'matched';
  await store.save(job);

  const rootFiles = jobFiles(await readdir(dir));
  const sicherFiles = jobFiles(await readdir(join(dir, 'sicher')));
  assert.equal(rootFiles.length, 0);
  assert.equal(sicherFiles.length, 1);
});

test('save(status=uncertain) → Datei landet in <dir>/unsicher/', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  job.status = 'uncertain';
  await store.save(job);

  const unsicherFiles = jobFiles(await readdir(join(dir, 'unsicher')));
  assert.equal(unsicherFiles.length, 1);
});

test('updateStatus new→matched→generated: Datei wandert, kein Duplikat', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  await store.save(job);

  await store.updateStatus(job.id, 'matched');
  assert.equal(jobFiles(await readdir(dir)).length, 0);
  assert.equal(jobFiles(await readdir(join(dir, 'sicher'))).length, 1);

  await store.updateStatus(job.id, 'generated');
  assert.equal(jobFiles(await readdir(join(dir, 'sicher'))).length, 0, 'alte Datei in sicher/ hätte entfernt werden müssen');
  assert.equal(jobFiles(await readdir(dir)).length, 1, 'neue Datei sollte zurück im Basisordner liegen');
});

test('get/exists/delete finden Jobs unabhängig vom Unterordner', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const job = toJob(fakeScraped());
  job.status = 'matched';
  await store.save(job);

  assert.equal(await store.exists(job.id), true);
  assert.equal((await store.get(job.id))?.id, job.id);

  await store.delete(job.id);
  assert.equal(await store.exists(job.id), false);
  assert.equal(jobFiles(await readdir(join(dir, 'sicher'))).length, 0);
});

test('list() findet Jobs aus Basisordner + beiden Unterordnern zusammen', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const store = createStorage(dir);
  const jNew = toJob(fakeScraped('New Job', 'Corp N'));
  const jMatched = toJob(fakeScraped('Matched Job', 'Corp M'));
  const jUncertain = toJob(fakeScraped('Uncertain Job', 'Corp U'));
  jMatched.status = 'matched';
  jUncertain.status = 'uncertain';

  await store.save(jNew);
  await store.save(jMatched);
  await store.save(jUncertain);

  assert.equal((await store.list()).length, 3);
  assert.equal((await store.list({ status: 'matched' })).length, 1);
  assert.equal((await store.list({ status: 'uncertain' })).length, 1);
  assert.equal((await store.list({ status: 'new' })).length, 1);
});
