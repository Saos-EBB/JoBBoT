import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAmsResult } from '../scrapers/ams.ts';
import type { AmsSearchResponse } from '../scrapers/ams.ts';

const sample = JSON.parse(readFileSync('test/fixtures/ams/api-sample.json', 'utf8')) as AmsSearchResponse;

test('parseAmsResult: ≥1 job, pflichtfelder gesetzt', () => {
  const jobs = (sample.results ?? []).map(parseAmsResult);
  assert.ok(jobs.length >= 1, `expected ≥1 job, got ${jobs.length}`);
  for (const j of jobs) {
    assert.ok(j.title.length > 0, 'title empty');
    assert.ok(j.company.length > 0, 'company empty');
    assert.ok(j.url.startsWith('https://jobs.ams.at/public/emps/jobs/'), `url invalid: ${j.url}`);
    assert.strictEqual(j.source, 'ams');
    assert.ok(j.description.length > 0, 'description empty');
  }
});

test('parseAmsResult: municipality bevorzugt vor federalState', () => {
  const job = parseAmsResult({
    id: 1,
    title: 'Test',
    company: { name: 'Test GmbH', address: { municipality: 'Linz', federalState: 'Oberösterreich' } },
  });
  assert.strictEqual(job.location, 'Linz');
});

test('parseAmsResult: fällt auf federalState zurück wenn municipality fehlt', () => {
  const job = parseAmsResult({
    id: 1,
    title: 'Test',
    company: { name: 'Test GmbH', address: { federalState: 'Steiermark' } },
  });
  assert.strictEqual(job.location, 'Steiermark');
});

test('parseAmsResult: fällt auf "Österreich" zurück wenn beides fehlt', () => {
  const job = parseAmsResult({ id: 1, title: 'Test', company: { name: 'Test GmbH' } });
  assert.strictEqual(job.location, 'Österreich');
});

test('parseAmsResult: url enthält id', () => {
  const job = parseAmsResult({ id: 22025446, title: 'Test', company: { name: 'X' } });
  assert.strictEqual(job.url, 'https://jobs.ams.at/public/emps/jobs/22025446');
});
