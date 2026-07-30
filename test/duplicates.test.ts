import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicates, planMerge } from '../lib/duplicates.ts';
import { toJob } from '../lib/normalize.ts';

const job = (overrides: Partial<{ title: string; company: string; scrapedAt: string; id: string }> = {}) => ({
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

test('planMerge: keeps the newest job, but carries over the oldest scrapedAt', () => {
  const a = job({ scrapedAt: '2026-07-01T00:00:00.000Z', id: 'aaaaaaaaaaaaaaaa' });
  const b = job({ scrapedAt: '2026-07-05T00:00:00.000Z', id: 'bbbbbbbbbbbbbbbb' });
  const plan = planMerge(findDuplicates([a, b])[0]);
  assert.equal(plan.keep, b);
  assert.equal(plan.scrapedAt, a.scrapedAt);
  assert.deepEqual(plan.remove, [a]);
});

test('planMerge: three-way duplicate keeps only the newest, removes the other two', () => {
  const a = job({ scrapedAt: '2026-07-01T00:00:00.000Z', id: 'aaaaaaaaaaaaaaaa' });
  const b = job({ scrapedAt: '2026-07-03T00:00:00.000Z', id: 'bbbbbbbbbbbbbbbb' });
  const c = job({ scrapedAt: '2026-07-05T00:00:00.000Z', id: 'cccccccccccccccc' });
  const plan = planMerge(findDuplicates([b, a, c])[0]);
  assert.equal(plan.keep, c);
  assert.equal(plan.scrapedAt, a.scrapedAt);
  assert.deepEqual(plan.remove, [a, b]);
});

// Der eigentliche Bug in der Praxis: ein echter Re-Scrape derselben Stelle trägt in
// BEIDEN Dateien dieselbe id (nur das Datum im Dateinamen/scrapedAt unterscheidet
// sich) — ein Vergleich über j.id statt Objektidentität hätte hier removeIds leer
// gelassen (nichts gelöscht) bzw. beide fälschlich als "neuestes" erkannt.
test('planMerge: same stored id for both duplicates (real re-scrape) still resolves correctly', () => {
  const a = job({ scrapedAt: '2026-07-29T00:00:00.000Z', id: 'c96d4809c96d4809' });
  const b = job({ scrapedAt: '2026-07-30T00:00:00.000Z', id: 'c96d4809c96d4809' });
  const plan = planMerge(findDuplicates([a, b])[0]);
  assert.equal(plan.keep, b);
  assert.equal(plan.scrapedAt, a.scrapedAt);
  assert.deepEqual(plan.remove, [a]);
});
