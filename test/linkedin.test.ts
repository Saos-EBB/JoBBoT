import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearchResults, parseDetailPage } from '../scrapers/linkedin.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';

const FIXTURES = 'test/fixtures/linkedin';
const searchHtml = readFileSync(`${FIXTURES}/search.html`, 'utf8');
const detailHtml = readFileSync(`${FIXTURES}/detail.html`, 'utf8');

const baseJob: ScrapedJob = {
  source: 'linkedin',
  url: 'https://at.linkedin.com/jobs/view/software-engineer-m-f-x-at-anyline-4417618340',
  title: 'Software Engineer (m/f/x)',
  company: 'Anyline',
  description: 'fallback',
};

test('parseSearchResults: ≥1 job, pflichtfelder gesetzt', () => {
  const jobs = parseSearchResults(searchHtml);
  assert.ok(jobs.length >= 1, `expected ≥1 job, got ${jobs.length}`);
  for (const j of jobs) {
    assert.ok(j.title.length > 0, 'title empty');
    assert.ok(j.company.length > 0, 'company empty');
    assert.ok(j.url.startsWith('https://'), `url invalid: ${j.url}`);
    assert.ok(!j.url.includes('?'), `url has tracking params: ${j.url}`);
    assert.strictEqual(j.source, 'linkedin');
  }
});

test('parseSearchResults: "" → []', () => {
  assert.deepStrictEqual(parseSearchResults(''), []);
});

test('parseDetailPage: description aus show-more-less-html__markup', () => {
  const result = parseDetailPage(detailHtml, baseJob);
  assert.ok(result.description.length > 50, 'description too short');
  assert.ok(!result.description.includes('Show less'), 'button text leaked into description');
});

test('parseDetailPage: "" → baseJob unverändert', () => {
  assert.deepStrictEqual(parseDetailPage('', baseJob), baseJob);
});
