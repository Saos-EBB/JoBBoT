import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapJudgment } from '../lib/filter-judgment.ts';
import type { FilterJudgment } from '../lib/filter-judgment.ts';

const judgment = (overrides: Partial<FilterJudgment> = {}): FilterJudgment => ({
  it_rolle: 'ja',
  erfahrung_ab_3j_erforderlich: 'nein',
  lehre_coding: 'n/a',
  junior_signal: 'ja',
  ...overrides,
});

test('it_rolle "nein" → filtered_out', () => {
  const result = mapJudgment(judgment({ it_rolle: 'nein' }), false);
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'IT-Rolle');
});

test('erfahrung_ab_3j_erforderlich "ja" → filtered_out', () => {
  const result = mapJudgment(judgment({ erfahrung_ab_3j_erforderlich: 'ja' }), false);
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Erfahrung ≥3J');
});

test('Lehre + lehre_coding "nein" → filtered_out', () => {
  const result = mapJudgment(judgment({ lehre_coding: 'nein' }), true);
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Lehre nicht coding');
});

test('Nicht-Lehre-Job: lehre_coding "nein" wird ignoriert (kein Lehre-Gate)', () => {
  const result = mapJudgment(judgment({ lehre_coding: 'nein' }), false);
  assert.equal(result.status, 'matched');
});

test('alle Kriterien unsicher → uncertain, NICHT raus', () => {
  const result = mapJudgment(judgment({
    it_rolle: 'unsicher',
    erfahrung_ab_3j_erforderlich: 'unsicher',
    junior_signal: 'nein',
  }), false);
  assert.equal(result.status, 'uncertain');
  assert.notEqual(result.status, 'filtered_out');
});

test('it_rolle ja, erfahrung nein, junior_signal ja → matched', () => {
  const result = mapJudgment(judgment(), false);
  assert.equal(result.status, 'matched');
});

test('dito aber junior_signal nein → uncertain', () => {
  const result = mapJudgment(judgment({ junior_signal: 'nein' }), false);
  assert.equal(result.status, 'uncertain');
});

test('junior_signal ja ABER ein Kriterium unsicher → uncertain', () => {
  const result = mapJudgment(judgment({ erfahrung_ab_3j_erforderlich: 'unsicher' }), false);
  assert.equal(result.status, 'uncertain');
});

test('kein Urteil (Parsefehler) → uncertain', () => {
  const result = mapJudgment(null, false);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.judgment, undefined);
});
