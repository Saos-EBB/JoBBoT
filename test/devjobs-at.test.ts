import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearchResults, parseDetailResult } from '../scrapers/devjobs-at.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';

const FIXTURES = 'test/fixtures/devjobs-at';
const searchCtx = JSON.parse(readFileSync(`${FIXTURES}/search-remix-context.json`, 'utf8')) as unknown;
const detailCtx = JSON.parse(readFileSync(`${FIXTURES}/detail-remix-context.json`, 'utf8')) as unknown;

const baseJob: ScrapedJob = {
  source: 'devjobs.at',
  url: 'https://www.devjobs.at/job/53dc1b88e4074acc49f32b1e071d5d0f',
  title: 'Flutter Developer',
  company: 'Orbyz',
  description: 'fallback',
};

// ── parseSearchResults ────────────────────────────────────────────────────────

test('parseSearchResults: ≥1 job aus Fixture', () => {
  const jobs = parseSearchResults(searchCtx);
  assert.ok(jobs.length >= 1, `expected ≥1, got ${jobs.length}`);
});

test('parseSearchResults: jeder Job hat title, company, url nicht leer', () => {
  const jobs = parseSearchResults(searchCtx);
  for (const j of jobs) {
    assert.ok(j.title.length > 0, `title leer bei ${j.url}`);
    assert.ok(j.company.length > 0, `company leer bei ${j.url}`);
    assert.ok(j.url.length > 0, `url leer`);
  }
});

test('parseSearchResults: url beginnt mit https://www.devjobs.at/job/', () => {
  const jobs = parseSearchResults(searchCtx);
  for (const j of jobs) {
    assert.ok(j.url.startsWith('https://www.devjobs.at/job/'), `url falsch: ${j.url}`);
  }
});

test('parseSearchResults: source === "devjobs.at"', () => {
  const jobs = parseSearchResults(searchCtx);
  for (const j of jobs) assert.strictEqual(j.source, 'devjobs.at');
});

test('parseSearchResults: {} → leeres Array, kein throw', () => {
  assert.deepStrictEqual(parseSearchResults({}), []);
});

test('parseSearchResults: null → leeres Array, kein throw', () => {
  assert.deepStrictEqual(parseSearchResults(null), []);
});

// ── parseDetailResult ─────────────────────────────────────────────────────────

test('parseDetailResult: description nicht leer', () => {
  const result = parseDetailResult(detailCtx, baseJob);
  assert.ok(result.description.length > 50, `description zu kurz: ${result.description.length}`);
});

test('parseDetailResult: description enthält HTML-Tags', () => {
  const result = parseDetailResult(detailCtx, baseJob);
  assert.ok(result.description.includes('<'), `kein HTML in description`);
});

test('parseDetailResult: {} → baseJob unverändert zurück', () => {
  assert.deepStrictEqual(parseDetailResult({}, baseJob), baseJob);
});
