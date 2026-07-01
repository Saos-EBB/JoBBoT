import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegexStrategy } from '../lib/filter-regex.ts';
import { loadExperienceRules } from '../lib/experience-regex.ts';
import { toJob } from '../lib/normalize.ts';

const cfg = loadExperienceRules();
const strategy = createRegexStrategy(cfg);

const sample = (title: string, description: string) => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title,
  company: 'Test GmbH',
  description,
});

test('disqualifizierende Erfahrung → filtered_out mit Regel + matched-Text', async () => {
  const job = sample('Software Developer', 'Anforderungen: Mind. 3 Jahre Berufserfahrung erforderlich.');
  const result = await strategy.decide(job, false);
  assert.equal(result.status, 'filtered_out');
  assert.match(result.rejectedBy ?? '', /Erfahrung ≥3J/);
});

test('Lehre ohne codingKeyword → filtered_out ("Lehre nicht coding-nah")', async () => {
  const job = sample('Lehre Elektrotechnik', 'Anforderungen: Interesse an Technik.');
  const result = await strategy.decide(job, true);
  assert.equal(result.status, 'filtered_out');
  assert.equal(result.rejectedBy, 'Lehre nicht coding-nah');
});

test('Lehre MIT codingKeyword → kein Lehre-Reject', async () => {
  const job = sample('Lehre Applikationsentwicklung', 'Anforderungen: Coding, Teamarbeit.');
  const result = await strategy.decide(job, true);
  assert.notEqual(result.rejectedBy, 'Lehre nicht coding-nah');
});

test('juniorSignal vorhanden, kein Reject → matched', async () => {
  const job = sample('Junior Developer', 'Anforderungen: TypeScript-Kenntnisse von Vorteil.');
  const result = await strategy.decide(job, false);
  assert.equal(result.status, 'matched');
});

test('kein Reject, kein juniorSignal → uncertain', async () => {
  const job = sample('Software Developer', 'Anforderungen: TypeScript-Kenntnisse.');
  const result = await strategy.decide(job, false);
  assert.equal(result.status, 'uncertain');
});
