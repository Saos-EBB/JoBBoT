import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCascade } from '../lib/filter-cascade.ts';
import type { Ask } from '../lib/filter-cascade.ts';
import type { Verdict } from '../lib/filter-llm.ts';
import { toJob } from '../lib/normalize.ts';

const sample = (title = 'Junior Developer') => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title,
  company: 'Test GmbH',
  description: 'Anforderungen: TypeScript-Kenntnisse.',
});

// liefert je Aufruf die nächste Antwort aus der Map (per Frage-Stichwort), zählt Calls
function mockAsk(answers: Record<string, Verdict>): { ask: Ask; calls: () => string[] } {
  const calls: string[] = [];
  const ask: Ask = async (question) => {
    calls.push(question);
    if (question.includes('IT/Softwarebranche')) return answers.it ?? 'ja';
    if (question.includes('mehrjährige Berufserfahrung')) return answers.exp ?? 'nein';
    if (question.includes('Applikationsentwicklung ausgerichtet')) return answers.lehre ?? 'ja';
    throw new Error(`unerwartete Frage: ${question}`);
  };
  return { ask, calls: () => calls };
}

test('alle Stufen passend → matched', async () => {
  const { ask } = mockAsk({ it: 'ja', exp: 'nein' });
  const result = await runCascade(sample(), { ask });
  assert.equal(result.status, 'matched');
  assert.equal(result.rejectedBy, undefined);
});

test('Stufe IT-Rolle "nein" → filtered_out, Kurzschluss (Erfahrung/Lehre nicht aufgerufen)', async () => {
  const { ask, calls } = mockAsk({ it: 'nein' });
  const result = await runCascade(sample(), { ask });
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'IT-Rolle');
  assert.equal(calls().length, 1);
});

test('Stufe Erfahrung "ja" → filtered_out', async () => {
  const { ask, calls } = mockAsk({ it: 'ja', exp: 'ja' });
  const result = await runCascade(sample(), { ask });
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Erfahrung');
  assert.equal(calls().length, 2);
});

test('eine Stufe "unsicher", Rest pass → uncertain', async () => {
  const { ask } = mockAsk({ it: 'unsicher', exp: 'nein' });
  const result = await runCascade(sample(), { ask });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.rejectedBy, undefined);
});

test('Lehre-Titel + Lehre-Stufe "nein" → filtered_out', async () => {
  const { ask } = mockAsk({ it: 'ja', exp: 'nein', lehre: 'nein' });
  const result = await runCascade(sample('Lehre Applikationsentwickler'), { ask });
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Lehre-Ausrichtung');
});

test('Lehre-Titel + Lehre-Stufe "ja" → matched', async () => {
  const { ask } = mockAsk({ it: 'ja', exp: 'nein', lehre: 'ja' });
  const result = await runCascade(sample('Lehre Applikationsentwickler'), { ask });
  assert.equal(result.status, 'matched');
});

test('Lehre-Titel + Lehre-Stufe "unsicher" → uncertain', async () => {
  const { ask } = mockAsk({ it: 'ja', exp: 'nein', lehre: 'unsicher' });
  const result = await runCascade(sample('Lehre Applikationsentwickler'), { ask });
  assert.equal(result.status, 'uncertain');
});

test('Nicht-Lehre-Job → Lehre-Stufe wird übersprungen', async () => {
  const { ask, calls } = mockAsk({ it: 'ja', exp: 'nein' });
  const result = await runCascade(sample('Junior Developer'), { ask });
  assert.equal(result.status, 'matched');
  assert.equal(calls().length, 2); // nur IT-Rolle + Erfahrung, keine Lehre-Frage
  assert.ok(!result.stages.some(s => s.stage === 'Lehre-Ausrichtung'));
});

test('askClearYesNo liefert "unsicher" (z.B. nach Parse-Fehlern) → Stufe unsure, Job uncertain statt filtered_out', async () => {
  const { ask } = mockAsk({ it: 'unsicher', exp: 'nein' });
  const result = await runCascade(sample(), { ask });
  assert.equal(result.status, 'uncertain');
  assert.notEqual(result.status, 'filtered_out');
});

test('Keyword-Stufe: "Senior ..."-Titel → filtered_out, KEIN LLM-Call', async () => {
  const { ask, calls } = mockAsk({});
  const result = await runCascade(sample('Senior Fullstack Developer'), { ask });
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Seniorität (Titel)');
  assert.equal(calls().length, 0);
});
