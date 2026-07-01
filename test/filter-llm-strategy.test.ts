import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmStrategy } from '../lib/filter-llm.ts';
import type { Judge } from '../lib/filter-llm.ts';
import type { FilterJudgment } from '../lib/filter-llm.ts';
import { toJob } from '../lib/normalize.ts';

const sample = (title = 'Junior Developer') => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title,
  company: 'Test GmbH',
  description: 'Anforderungen: TypeScript-Kenntnisse.',
});

const judgment = (overrides: Partial<FilterJudgment> = {}): FilterJudgment => ({
  it_rolle: 'ja',
  erfahrung_ab_3j_erforderlich: 'nein',
  lehre_coding: 'n/a',
  junior_signal: 'ja',
  ...overrides,
});

function mockJudge(result: FilterJudgment | null): { judge: Judge; calls: () => number } {
  let calls = 0;
  const judge: Judge = async () => { calls++; return result; };
  return { judge, calls: () => calls };
}

test('it_rolle "nein" → filtered_out', async () => {
  const { judge } = mockJudge(judgment({ it_rolle: 'nein' }));
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample(), false);
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'IT-Rolle');
});

test('erfahrung_ab_3j_erforderlich "ja" → filtered_out', async () => {
  const { judge } = mockJudge(judgment({ erfahrung_ab_3j_erforderlich: 'ja' }));
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample(), false);
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Erfahrung ≥3J');
});

test('Lehre + lehre_coding "nein" → filtered_out', async () => {
  const { judge } = mockJudge(judgment({ lehre_coding: 'nein' }));
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample('Lehre Applikationsentwickler'), true);
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Lehre nicht coding');
});

test('Nicht-Lehre-Job: lehre_coding "nein" wird ignoriert (kein Lehre-Gate)', async () => {
  const { judge } = mockJudge(judgment({ lehre_coding: 'nein' }));
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample('Junior Developer'), false);
  assert.equal(result.status, 'matched');
});

test('alle Kriterien unsicher → uncertain, NICHT raus', async () => {
  const { judge } = mockJudge(judgment({
    it_rolle: 'unsicher',
    erfahrung_ab_3j_erforderlich: 'unsicher',
    junior_signal: 'nein',
  }));
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample(), false);
  assert.equal(result.status, 'uncertain');
  assert.notEqual(result.status, 'filtered_out');
});

test('it_rolle ja, erfahrung nein, junior_signal ja → matched', async () => {
  const { judge } = mockJudge(judgment());
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample(), false);
  assert.equal(result.status, 'matched');
});

test('dito aber junior_signal nein → uncertain', async () => {
  const { judge } = mockJudge(judgment({ junior_signal: 'nein' }));
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample(), false);
  assert.equal(result.status, 'uncertain');
});

test('junior_signal ja ABER ein Kriterium unsicher → uncertain', async () => {
  const { judge } = mockJudge(judgment({ erfahrung_ab_3j_erforderlich: 'unsicher' }));
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample(), false);
  assert.equal(result.status, 'uncertain');
});

test('judgeJob liefert null (Parsefehler) → uncertain', async () => {
  const { judge } = mockJudge(null);
  const strategy = createLlmStrategy({ judge });
  const result = await strategy.decide(sample(), false);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.judgment, undefined);
});
