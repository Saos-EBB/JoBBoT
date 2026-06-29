import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearchPage, parseDetailPage } from '../scrapers/karriere-at.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';

const FIXTURES = 'test/fixtures/karriere-at';
const searchHtml = readFileSync(`${FIXTURES}/search.html`, 'utf8');
const detailHtml = readFileSync(`${FIXTURES}/detail.html`, 'utf8');

const baseJob: ScrapedJob = {
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/7829963',
  title: 'Test Job',
  company: 'Test GmbH',
  description: 'fallback',
};

test('parseSearchPage: ≥1 job, pflichtfelder gesetzt', () => {
  const jobs = parseSearchPage(searchHtml);
  assert.ok(jobs.length >= 1, `expected ≥1 job, got ${jobs.length}`);
  for (const j of jobs) {
    assert.ok(j.title.length > 0, 'title empty');
    assert.ok(j.company.length > 0, 'company empty');
    assert.ok(j.url.startsWith('https://'), `url invalid: ${j.url}`);
    assert.strictEqual(j.source, 'karriere.at');
  }
});

test('parseSearchPage: "" → []', () => {
  assert.deepStrictEqual(parseSearchPage(''), []);
});

test('parseDetailPage: description + postedAt aus JSON-LD', () => {
  const result = parseDetailPage(detailHtml, baseJob);
  assert.ok(result.description.length > 50, 'description too short');
  assert.ok(result.postedAt?.includes('2026'), `postedAt wrong: ${result.postedAt}`);
});

test('parseDetailPage: "" → baseJob unverändert', () => {
  assert.deepStrictEqual(parseDetailPage('', baseJob), baseJob);
});
