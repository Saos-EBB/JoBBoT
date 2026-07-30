import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicates } from '../lib/duplicates.ts';
import { toJob } from '../lib/normalize.ts';

const job = (overrides: Partial<{ title: string; company: string; scrapedAt: string }> = {}) => ({
  ...toJob({
    source: 'karriere.at',
    url: 'https://www.karriere.at/jobs/123',
    title: 'Junior Developer (m/w/d)',
    company: 'Test GmbH',
    description: 'Anforderungen: TypeScript-Kenntnisse.',
  }),
  ...overrides,
});

test('no duplicates among distinct jobs', () => {
  const jobs = [job({ title: 'Junior Developer' }), job({ title: 'Senior Developer' })];
  assert.deepEqual(findDuplicates(jobs), []);
});

test('finds duplicates by normalized title+company, ignoring stored id/case/gender-marker/legal-form drift', () => {
  const a = job({ title: 'Junior Developer (m/w/d)', company: 'Test GmbH', scrapedAt: '2026-07-01T00:00:00.000Z' });
  const b = job({ title: 'JUNIOR DEVELOPER (w/m/d)', company: 'Test', scrapedAt: '2026-07-02T00:00:00.000Z' });
  const c = job({ title: 'Unrelated Job', company: 'Other Inc' });

  const groups = findDuplicates([a, b, c]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].jobs.length, 2);
  // ältester scrapedAt zuerst
  assert.equal(groups[0].jobs[0].scrapedAt, a.scrapedAt);
  assert.equal(groups[0].jobs[1].scrapedAt, b.scrapedAt);
});

test('three-way duplicate lands in a single group, not three pairs', () => {
  const jobs = [job(), job(), job()];
  const groups = findDuplicates(jobs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].jobs.length, 3);
});
