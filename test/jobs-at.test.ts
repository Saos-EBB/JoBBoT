import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearchPage, parseDetailPage } from '../scrapers/jobs-at.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';

const FIXTURES = 'test/fixtures/jobs-at';
const searchHtml = readFileSync(`${FIXTURES}/search.html`, 'utf8');
const detailHtml = readFileSync(`${FIXTURES}/detail.html`, 'utf8');

const baseJob: Partial<ScrapedJob> = {
  source: 'jobs.at',
  url: 'https://www.jobs.at/i/7811246',
  title: 'Fallback Titel',
  company: 'Fallback GmbH',
};

test('parseSearchPage: ≥1 Eintrag, jeder mit url (/i/{id}) + title', () => {
  const jobs = parseSearchPage(searchHtml);
  assert.ok(jobs.length >= 1, `expected ≥1, got ${jobs.length}`);
  for (const j of jobs) {
    assert.ok(j.url?.startsWith('https://www.jobs.at/i/'), `url invalid: ${j.url}`);
    assert.ok((j.title?.length ?? 0) > 0, 'title empty');
    assert.strictEqual(j.source, 'jobs.at');
  }
});

test('parseSearchPage: dedupliziert gleiche url innerhalb der Seite', () => {
  const jobs = parseSearchPage(searchHtml);
  const urls = jobs.map(j => j.url);
  assert.strictEqual(new Set(urls).size, urls.length);
});

test('parseSearchPage: enthält bekannten Job aus der Fixture', () => {
  const jobs = parseSearchPage(searchHtml);
  const job = jobs.find(j => j.url === 'https://www.jobs.at/i/7811246');
  assert.ok(job, 'erwarteter Job nicht gefunden');
  assert.strictEqual(job?.title, 'Lead Buyer für schweren Stahlbau (m/w/d)');
  assert.strictEqual(job?.company, 'Liebherr-Werk Nenzing GmbH');
  assert.strictEqual(job?.location, 'Nenzing');
});

test('parseSearchPage: "" → []', () => {
  assert.deepStrictEqual(parseSearchPage(''), []);
});

test('parseDetailPage: company + description nicht leer, location gesetzt, source korrekt', () => {
  const job = parseDetailPage(detailHtml, baseJob);
  assert.strictEqual(job.source, 'jobs.at');
  assert.ok(job.company.length > 0, 'company leer');
  assert.ok(job.description.length > 0, 'description leer');
  assert.ok(job.location && job.location.length > 0, 'location leer');
  assert.strictEqual(job.url, 'https://www.jobs.at/i/7811246');
});

test('parseDetailPage: Felder aus JSON-LD korrekt gemappt', () => {
  const job = parseDetailPage(detailHtml, baseJob);
  assert.strictEqual(job.title, 'Lead Buyer für schweren Stahlbau (m/w/d)');
  assert.strictEqual(job.company, 'Liebherr-Werk Nenzing GmbH');
  assert.strictEqual(job.location, 'Nenzing, Vorarlberg');
  assert.strictEqual(job.postedAt, '2025-08-25');
});

test('parseDetailPage: "" → kein throw, baut aus base zusammen', () => {
  const job = parseDetailPage('', baseJob);
  assert.strictEqual(job.title, baseJob.title);
  assert.strictEqual(job.company, baseJob.company);
  assert.strictEqual(job.description, '');
});

test('parseDetailPage: kaputtes HTML ohne JSON-LD → kein throw, Fallback auf base', () => {
  const job = parseDetailPage('<html><body>keine Daten hier</body></html>', baseJob);
  assert.strictEqual(job.title, baseJob.title);
  assert.strictEqual(job.url, baseJob.url);
  assert.strictEqual(job.description, '');
});
