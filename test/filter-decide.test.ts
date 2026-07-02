import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, resolveStrategy } from '../lib/filter-decide.ts';
import type { FilterStrategy, Decision } from '../lib/filter-types.ts';
import { toJob } from '../lib/normalize.ts';

const sample = (title = 'Junior Developer') => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title,
  company: 'Test GmbH',
  description: 'Anforderungen: TypeScript-Kenntnisse.',
});

function mockStrategy(result: Decision): { strategy: FilterStrategy; calls: () => { job: unknown; isLehre: boolean }[] } {
  const calls: { job: unknown; isLehre: boolean }[] = [];
  const strategy: FilterStrategy = {
    name: 'mock',
    async decide(job, isLehre) {
      calls.push({ job, isLehre });
      return result;
    },
  };
  return { strategy, calls: () => calls };
}

test('Titel "Senior…" → filtered_out, Strategie NICHT aufgerufen', async () => {
  const { strategy, calls } = mockStrategy({ status: 'matched' });
  const result = await decide(sample('Senior Fullstack Developer'), { strategy });
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Seniorität (Titel)');
  assert.equal(calls().length, 0);
});

test('kein Seniorität-Ausschluss → delegiert an die Strategie, Decision unverändert', async () => {
  const { strategy } = mockStrategy({ status: 'matched' });
  const result = await decide(sample(), { strategy });
  assert.equal(result.status, 'matched');
});

test('isLehre wird korrekt an die Strategie durchgereicht', async () => {
  const { strategy, calls } = mockStrategy({ status: 'uncertain' });
  await decide(sample('Lehre Applikationsentwickler'), { strategy });
  assert.equal(calls()[0].isLehre, true);

  await decide(sample('Junior Developer'), { strategy });
  assert.equal(calls()[1].isLehre, false);
});

test('resolveStrategy: mode "regex" → regexStrategy (name "regex")', () => {
  const strategy = resolveStrategy('regex');
  assert.equal(strategy.name, 'regex');
});

test('resolveStrategy: mode "llama" → llmStrategy (name "llama")', () => {
  const strategy = resolveStrategy('llama');
  assert.equal(strategy.name, 'llama');
});

test('resolveStrategy: ungültiger Modus → Fehler listet gültige Werte', () => {
  assert.throws(
    // @ts-expect-error absichtlich ungültiger Wert
    () => resolveStrategy('yolo'),
    /llama, regex/,
  );
});

test('regex-Modus: judgeJob/Ollama wird NICHT aufgerufen (Spy)', async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { called = true; throw new Error('sollte nicht aufgerufen werden'); }) as typeof fetch;
  try {
    const result = await decide(sample(), { mode: 'regex' });
    assert.equal(called, false);
    assert.ok(result.status);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
