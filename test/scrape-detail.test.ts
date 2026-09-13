import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDetailPhase } from '../lib/scrape-detail.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';

const cand = (n: number): ScrapedJob => ({
  source: 'test',
  url: `https://x/${n}`,
  title: `Job ${n}`,
  company: 'C',
  description: '',
});

test('runDetailPhase: reichert jeden Kandidaten an, Reihenfolge bleibt', async () => {
  const candidates = [cand(1), cand(2), cand(3)];
  const results = await runDetailPhase(candidates, {
    source: 'test',
    fetchDetail: async job => ({ ...job, description: `desc ${job.url}` }),
  });
  assert.deepEqual(results.map(r => r.description), ['desc https://x/1', 'desc https://x/2', 'desc https://x/3']);
});

test('runDetailPhase: onProgress pro Kandidat (1..total)', async () => {
  const seen: [number, number][] = [];
  await runDetailPhase([cand(1), cand(2)], {
    source: 'test',
    fetchDetail: async j => j,
    onProgress: (c, t) => seen.push([c, t]),
  });
  assert.deepEqual(seen, [[1, 2], [2, 2]]);
});

test('runDetailPhase: fetchDetail wirft → Basis-Job bleibt, Lauf läuft weiter', async () => {
  const candidates = [cand(1), cand(2), cand(3)];
  const results = await runDetailPhase(candidates, {
    source: 'test',
    fetchDetail: async job => {
      if (job.url.endsWith('/2')) throw new Error('boom');
      return { ...job, description: 'ok' };
    },
  });
  assert.equal(results.length, 3);
  assert.equal(results[0].description, 'ok');
  assert.equal(results[1].description, '', 'Basis-Job unverändert behalten');
  assert.equal(results[2].description, 'ok');
});

test('runDetailPhase: batchSize → onUnitDone in Blöcken, Rest per flush', async () => {
  const batches: number[] = [];
  await runDetailPhase([cand(1), cand(2), cand(3)], {
    source: 'test',
    fetchDetail: async j => j,
    onUnitDone: items => batches.push(items.length),
    batchSize: 2,
  });
  assert.deepEqual(batches, [2, 1]); // 2 im ersten Block, 1 beim flush
});

test('runDetailPhase: ohne batchSize → kein onUnitDone', async () => {
  let called = 0;
  await runDetailPhase([cand(1), cand(2)], {
    source: 'test',
    fetchDetail: async j => j,
    onUnitDone: () => { called++; },
  });
  assert.equal(called, 0);
});

test('runDetailPhase: leere Kandidatenliste → [], kein onUnitDone', async () => {
  let called = 0;
  const results = await runDetailPhase([], {
    source: 'test',
    fetchDetail: async j => j,
    onUnitDone: () => { called++; },
    batchSize: 2,
  });
  assert.deepEqual(results, []);
  assert.equal(called, 0);
});
