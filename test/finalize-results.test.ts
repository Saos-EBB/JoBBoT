import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeResults } from '../lib/finalize-results.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';

const job = (url: string, title = 'T'): ScrapedJob => ({
  source: 'test', url, title, company: 'C', description: '',
});

test('dedupliziert nach url, erster Treffer gewinnt', () => {
  const a = job('https://x/1', 'Erste');
  const b = job('https://x/1', 'Zweite');
  const result = finalizeResults('test', [a, b, job('https://x/2')]);
  assert.equal(result.length, 2);
  assert.equal(result.find(j => j.url === 'https://x/1')!.title, 'Erste');
});

test('ohne keep-Filter bleiben alle deduplizierten Jobs', () => {
  const result = finalizeResults('test', [job('https://x/1'), job('https://x/2')]);
  assert.equal(result.length, 2);
});

test('keep-Filter wird nach dem Dedup angewendet', () => {
  const result = finalizeResults('test', [job('https://x/1'), job('https://x/2', 'nope')], j => j.title !== 'nope');
  assert.deepEqual(result.map(j => j.url), ['https://x/1']);
});

test('loggt Location-Gate mit Quelle, Gesamt- und Kandidatenzahl', () => {
  const calls: unknown[][] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => calls.push(args);
  try {
    finalizeResults('quelle-x', [job('https://x/1'), job('https://x/2', 'nope')], j => j.title !== 'nope');
  } finally {
    console.log = original;
  }
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /quelle-x/);
  assert.match(String(calls[0][0]), /2 Treffer/);
  assert.match(String(calls[0][0]), /1 nach Location-Gate/);
});
