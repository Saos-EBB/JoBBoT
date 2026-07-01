import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../lib/scrape-runner.ts';
import { createStorage } from '../storage/index.ts';
import type { ScraperAdapter, ScrapedJob } from '../scrapers/interface.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const job = (title: string, company: string): ScrapedJob => ({
  source: 'test', url: `https://example.com/${title}`, title, company, description: '',
});

function okAdapter(name: string, jobs: ScrapedJob[]): ScraperAdapter {
  return { name, async scrape() { return jobs; } };
}

function failingAdapter(name: string, message: string): ScraperAdapter {
  return { name, async scrape() { throw new Error(message); } };
}

test('2 erfolgreiche Quellen + 1 werfende → Erfolge liefern Jobs, Fehler wird gemeldet, Lauf bricht nicht ab', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const registry: Record<string, ScraperAdapter> = {
    a: okAdapter('a', [job('Job A1', 'Firma A')]),
    b: okAdapter('b', [job('Job B1', 'Firma B'), job('Job B2', 'Firma B')]),
    c: failingAdapter('c', 'netzwerk kaputt'),
  };

  const outcomes = await runScrape({
    names: ['a', 'b', 'c'],
    registry,
    queriesFor: () => [],
    storage,
  });

  assert.equal(outcomes.length, 3);
  const byName = Object.fromEntries(outcomes.map(o => [o.name, o]));
  assert.equal(byName.a.ok, true);
  assert.equal(byName.a.newCount, 1);
  assert.equal(byName.b.ok, true);
  assert.equal(byName.b.newCount, 2);
  assert.equal(byName.c.ok, false);
  assert.match(String(byName.c.error), /netzwerk kaputt/);

  const saved = await storage.list();
  assert.equal(saved.length, 3);
});

test('dieselbe jobId aus zwei Quellen → nur 1 Datei, Zähler stimmt (neu bei erster, dedup bei zweiter)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const sameJob = job('Duplicate Job', 'Same Company');
  const registry: Record<string, ScraperAdapter> = {
    a: okAdapter('a', [sameJob]),
    b: okAdapter('b', [{ ...sameJob }]),
  };

  const outcomes = await runScrape({
    names: ['a', 'b'],
    registry,
    queriesFor: () => [],
    storage,
  });

  const byName = Object.fromEntries(outcomes.map(o => [o.name, o]));
  assert.equal(byName.a.newCount, 1);
  assert.equal(byName.a.skipCount, 0);
  assert.equal(byName.b.newCount, 0);
  assert.equal(byName.b.skipCount, 1);

  const saved = await storage.list();
  assert.equal(saved.length, 1);
});

test('keep-Filter wird an jeden Adapter durchgereicht', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  let receivedKeep: ((job: ScrapedJob) => boolean) | undefined;
  const registry: Record<string, ScraperAdapter> = {
    a: {
      name: 'a',
      async scrape(_queries, keepFn) {
        receivedKeep = keepFn;
        return [];
      },
    },
  };
  const keep = (j: ScrapedJob) => j.title === 'nope';

  await runScrape({ names: ['a'], registry, queriesFor: () => [], keep, storage });
  assert.equal(receivedKeep, keep);
});

test('onProgress wird pro Quelle mit ihrem Namen aufgerufen', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const calls: { name: string; current: number; total: number }[] = [];
  const registry: Record<string, ScraperAdapter> = {
    a: {
      name: 'a',
      async scrape(_queries, _keep, onProgress) {
        onProgress?.(1, 2);
        onProgress?.(2, 2);
        return [];
      },
    },
  };

  await runScrape({
    names: ['a'],
    registry,
    queriesFor: () => [],
    storage,
    onProgress: (name, current, total) => calls.push({ name, current, total }),
  });

  assert.deepEqual(calls, [{ name: 'a', current: 1, total: 2 }, { name: 'a', current: 2, total: 2 }]);
});
