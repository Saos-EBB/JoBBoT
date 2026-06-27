import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJob } from '../lib/normalize.ts';
import { jobId } from '../lib/hash.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const base: ScrapedJob = {
  source: 'test',
  url: 'https://example.com/job/1',
  title: 'Software Engineer',
  company: 'Testcorp',
  description: 'Do stuff.',
};

test('all required fields present', () => {
  const job = toJob(base);
  assert.ok(job.id);
  assert.ok(job.source);
  assert.ok(job.url);
  assert.ok(job.title);
  assert.ok(job.company);
  assert.ok(job.description);
  assert.ok(job.scrapedAt);
  assert.ok(job.updatedAt);
  assert.ok(job.status);
});

test('status === "new"', () => {
  assert.equal(toJob(base).status, 'new');
});

test('match === null, coverLetter === null', () => {
  const job = toJob(base);
  assert.equal(job.match, null);
  assert.equal(job.coverLetter, null);
});

test('scrapedAt === updatedAt on creation', () => {
  const job = toJob(base);
  assert.equal(job.scrapedAt, job.updatedAt);
});

test('timestamps are valid ISO 8601', () => {
  const job = toJob(base);
  assert.match(job.scrapedAt, ISO_RE);
  assert.match(job.updatedAt, ISO_RE);
  assert.ok(!Number.isNaN(Date.parse(job.scrapedAt)));
  assert.ok(!Number.isNaN(Date.parse(job.updatedAt)));
});

test('id === jobId(input)', () => {
  assert.equal(toJob(base).id, jobId(base));
});

test('optional fields passed through when present', () => {
  const input: ScrapedJob = { ...base, location: 'Wien', salary: '80k', postedAt: '2026-01-01T00:00:00.000Z' };
  const job = toJob(input);
  assert.equal(job.location, 'Wien');
  assert.equal(job.salary, '80k');
  assert.equal(job.postedAt, '2026-01-01T00:00:00.000Z');
});

test('optional fields absent when not provided — no undefined-string', () => {
  const job = toJob(base);
  assert.equal(job.location, undefined);
  assert.equal(typeof job.location, 'undefined'); // guard: not the string "undefined"
});

test('toJob does not mutate input', () => {
  const input: ScrapedJob = { ...base };
  const snapshot = JSON.stringify(input);
  toJob(input);
  assert.equal(JSON.stringify(input), snapshot);
});
