import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../lib/scrape-runner.ts';
import { createStorage } from '../storage/index.ts';
import type { ScraperAdapter, ScrapedJob } from '../scrapers/interface.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const job = (title: string, company: string): ScrapedJob => ({
  source: 'test', url: `https://example.com/${title}`, title, company, description: '',
});

function okAdapter(name: string, jobs: ScrapedJob[], kind: 'fetch' | 'browser' = 'fetch'): ScraperAdapter {
  return { name, kind, async scrape() { return jobs; } };
}

function failingAdapter(name: string, message: string, kind: 'fetch' | 'browser' = 'fetch'): ScraperAdapter {
  return { name, kind, async scrape() { throw new Error(message); } };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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
      kind: 'fetch',
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
      kind: 'fetch',
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

// ── Scheduler: Concurrency-Limits ────────────────────────────────────────────

function trackingAdapter(name: string, kind: 'fetch' | 'browser', ms: number, tracker: { active: number; max: number; activeBrowsers: number; maxBrowsers: number }): ScraperAdapter {
  return {
    name,
    kind,
    async scrape() {
      tracker.active++;
      if (kind === 'browser') tracker.activeBrowsers++;
      tracker.max = Math.max(tracker.max, tracker.active);
      tracker.maxBrowsers = Math.max(tracker.maxBrowsers, tracker.activeBrowsers);
      await delay(ms);
      tracker.active--;
      if (kind === 'browser') tracker.activeBrowsers--;
      return [];
    },
  };
}

test('Scheduler: nie mehr als 2 Adapter gleichzeitig aktiv', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    a: trackingAdapter('a', 'fetch', 30, tracker),
    b: trackingAdapter('b', 'fetch', 30, tracker),
    c: trackingAdapter('c', 'fetch', 30, tracker),
    d: trackingAdapter('d', 'fetch', 30, tracker),
  };

  await runScrape({ names: ['a', 'b', 'c', 'd'], registry, queriesFor: () => [], storage });
  assert.ok(tracker.max <= 2, `erwartet ≤2 gleichzeitig, war ${tracker.max}`);
});

test('Scheduler: nie 2 Browser-Adapter gleichzeitig, auch wenn Gesamt-Slot frei wäre', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    browser1: trackingAdapter('browser1', 'browser', 30, tracker),
    browser2: trackingAdapter('browser2', 'browser', 30, tracker),
    fetch1: trackingAdapter('fetch1', 'fetch', 30, tracker),
  };

  await runScrape({ names: ['browser1', 'browser2', 'fetch1'], registry, queriesFor: () => [], storage });
  assert.ok(tracker.maxBrowsers <= 1, `erwartet ≤1 Browser gleichzeitig, war ${tracker.maxBrowsers}`);
  assert.ok(tracker.max <= 2, `erwartet ≤2 gleichzeitig, war ${tracker.max}`);
});

test('Scheduler: ein Fetch-Adapter darf neben einem laufenden Browser-Adapter laufen', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    browser1: trackingAdapter('browser1', 'browser', 40, tracker),
    fetch1: trackingAdapter('fetch1', 'fetch', 10, tracker),
  };

  await runScrape({ names: ['browser1', 'fetch1'], registry, queriesFor: () => [], storage });
  assert.equal(tracker.max, 2, `browser+fetch sollten gleichzeitig laufen, war ${tracker.max}`);
});

test('Scheduler: werfender Adapter blockiert die anderen nicht, auch unter Drosselung', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    fails: { name: 'fails', kind: 'browser', async scrape() { throw new Error('boom'); } },
    a: trackingAdapter('a', 'fetch', 10, tracker),
    b: trackingAdapter('b', 'fetch', 10, tracker),
  };

  const outcomes = await runScrape({ names: ['fails', 'a', 'b'], registry, queriesFor: () => [], storage });
  const byName = Object.fromEntries(outcomes.map(o => [o.name, o]));
  assert.equal(byName.fails.ok, false);
  assert.equal(byName.a.ok, true);
  assert.equal(byName.b.ok, true);
});

function timedAdapter(name: string, kind: 'fetch' | 'browser', ms: number, starts: Record<string, number>, t0: number): ScraperAdapter {
  return {
    name,
    kind,
    async scrape() {
      starts[name] = performance.now() - t0;
      await delay(ms);
      return [];
    },
  };
}

// Regression: im Live-Lauf blockierte ein Browser-Adapter (der auf den knapperen
// Browser-Slot wartete) einen längst bereiten Fetch-Adapter, weil er zuerst einen
// allgemeinen Slot ergattert hatte und ihn nutzlos festhielt. Fix: Browser-Slot
// wird VOR dem allgemeinen Slot erworben, ein wartender Browser-Adapter belegt
// also nie einen allgemeinen Slot ohne ihn zu nutzen.
test('Scheduler: ein wartender Browser-Adapter blockiert einen bereiten Fetch-Adapter NICHT', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const t0 = performance.now();
  const starts: Record<string, number> = {};
  const registry: Record<string, ScraperAdapter> = {
    browser1: timedAdapter('browser1', 'browser', 150, starts, t0),
    browser2: timedAdapter('browser2', 'browser', 20, starts, t0),
    fetch1: timedAdapter('fetch1', 'fetch', 20, starts, t0),
    fetch2: timedAdapter('fetch2', 'fetch', 20, starts, t0),
  };

  await runScrape({
    names: ['browser1', 'browser2', 'fetch1', 'fetch2'],
    registry,
    queriesFor: () => [],
    storage,
  });

  // fetch2 muss starten, sobald fetch1 fertig ist (~20ms) — NICHT erst wenn
  // browser1 nach 150ms fertig ist und browser2 aus der Browser-Queue entlässt.
  assert.ok(starts.fetch2 < 100, `fetch2 sollte lange vor browser1s Ende starten, startete bei ${starts.fetch2}ms`);
  // browser2 darf erst starten, nachdem browser1 den Browser-Slot freigegeben hat.
  assert.ok(starts.browser2 >= 140, `browser2 sollte erst nach browser1 (150ms) starten, startete bei ${starts.browser2}ms`);
});

test('Scheduler: maxConcurrent/maxBrowsers per Option überschreibbar', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    b1: trackingAdapter('b1', 'browser', 20, tracker),
    b2: trackingAdapter('b2', 'browser', 20, tracker),
  };

  await runScrape({ names: ['b1', 'b2'], registry, queriesFor: () => [], storage, maxConcurrent: 2, maxBrowsers: 2 });
  assert.equal(tracker.maxBrowsers, 2);
});
