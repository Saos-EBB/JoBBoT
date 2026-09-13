import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicates, planMerge, mergeGroups, type MergeBriefOps } from '../lib/duplicates.ts';
import type { Storage } from '../storage/json-store.ts';
import type { Job } from '../scrapers/interface.ts';
import { toJob } from '../lib/normalize.ts';

// Fake-Storage, der nur die zwei von mergeGroups benutzten Aufrufe mitschreibt.
function fakeStorage() {
  const deleted: Job[] = [];
  const saved: Job[] = [];
  const storage = {
    save: async (j: Job) => { saved.push(j); },
    deleteJob: async (j: Job) => { deleted.push(j); },
  } as unknown as Storage;
  return { deleted, saved, storage };
}

const noBrief: MergeBriefOps = { find: async () => null, carry: async () => {} };

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

// Der Fall aus den echten Daten: dieselbe Stelle auf karriere.at und jobs.at, die
// Titel unterscheiden sich NUR im Gedankenstrich (karriere.at " – ", jobs.at "  ").
// normalizeTitle hat vorher nur Whitespace kollabiert, Satzzeichen blieben stehen —
// zwei ids, kein Duplikat.
test('finds duplicates that differ only in punctuation across portals', () => {
  const a = job({ title: 'Technical Support Engineer (m/w/d) – 1st Level (AMR/Robotics)', company: 'AGILOX Services GmbH' });
  const b = job({ title: 'Technical Support Engineer (m/w/d)  1st Level (AMR/Robotics)', company: 'AGILOX Services GmbH' });
  assert.equal(findDuplicates([a, b]).length, 1);
});

test('gender suffix on the noun does not split a group', () => {
  const a = job({ title: 'Softwareentwickler:in Backend', company: 'Test GmbH' });
  const b = job({ title: 'Softwareentwickler Backend', company: 'Test GmbH' });
  assert.equal(findDuplicates([a, b]).length, 1);
});

// Gegenprobe zum Suffix-Strip: "in" am Wortende ohne Trenner bleibt Teil des Wortes.
test('a word merely ending in "in" is not treated as a gender suffix', () => {
  const a = job({ title: 'Marketing Manager Berlin', company: 'Test GmbH' });
  const b = job({ title: 'Marketing Manager Berl', company: 'Test GmbH' });
  assert.deepEqual(findDuplicates([a, b]), []);
});

// Firmenlose Jobs (jobs.at liefert die Firma nicht immer) dürfen nicht über den
// Titel allein verschmolzen werden — ein Merge löscht Dateien.
test('jobs without a company are never grouped, even with identical titles', () => {
  const a = job({ title: 'Software-Entwickler (m/w/d)', company: '' });
  const b = job({ title: 'Software-Entwickler (m/w/d)', company: '   ' });
  assert.deepEqual(findDuplicates([a, b]), []);
});

// ── mergeGroups (Ausführung, vorher inline & ungetestet im Route-Handler) ──────

test('mergeGroups: löscht beide Zwillinge, speichert behaltenen unter ältestem scrapedAt', async () => {
  const a = job({ scrapedAt: '2026-07-01T00:00:00.000Z', id: 'aaaaaaaaaaaaaaaa' });
  const b = job({ scrapedAt: '2026-07-05T00:00:00.000Z', id: 'bbbbbbbbbbbbbbbb' });
  const groups = findDuplicates([a, b]);
  const fake = fakeStorage();

  const merged = await mergeGroups(groups, fake.storage, noBrief, () => new Date('2026-08-01T00:00:00.000Z'));

  assert.equal(merged, 1);
  assert.ok(fake.deleted.includes(a), 'älterer Zwilling gelöscht');
  assert.ok(fake.deleted.includes(b), 'behaltener Job vor Neuspeichern exakt gelöscht');
  assert.equal(fake.saved.length, 1);
  assert.equal(fake.saved[0].id, b.id, 'neuester bleibt');
  assert.equal(fake.saved[0].scrapedAt, a.scrapedAt, 'ältestes scrapedAt übernommen');
  assert.equal(fake.saved[0].updatedAt, '2026-08-01T00:00:00.000Z');
});

test('mergeGroups: trägt den Brief des jüngsten entfernten Zwillings mit, wenn der behaltene keinen hat', async () => {
  const a = job({ scrapedAt: '2026-07-01T00:00:00.000Z', id: 'aaaaaaaaaaaaaaaa' });
  const b = job({ scrapedAt: '2026-07-03T00:00:00.000Z', id: 'bbbbbbbbbbbbbbbb' });
  const c = job({ scrapedAt: '2026-07-05T00:00:00.000Z', id: 'cccccccccccccccc' }); // neuester = keep
  const groups = findDuplicates([a, b, c]);
  const fake = fakeStorage();
  const carried: { from: string; to: Job }[] = [];
  const briefByJob = new Map<Job, string>([[a, '/x/a.md'], [b, '/x/b.md']]);

  await mergeGroups(groups, fake.storage, {
    find: async (jb) => briefByJob.get(jb) ?? null, // c hat keinen
    carry: async (from, to) => { carried.push({ from, to }); },
  });

  assert.equal(carried.length, 1);
  assert.equal(carried[0].from, '/x/b.md', 'jüngster entfernter Zwilling mit Brief gewinnt');
  assert.equal(carried[0].to, c);
});

test('mergeGroups: behaltener Job hat schon einen Brief → kein carry', async () => {
  const a = job({ scrapedAt: '2026-07-01T00:00:00.000Z', id: 'aaaaaaaaaaaaaaaa' });
  const b = job({ scrapedAt: '2026-07-05T00:00:00.000Z', id: 'bbbbbbbbbbbbbbbb' });
  const groups = findDuplicates([a, b]);
  const fake = fakeStorage();
  let carries = 0;

  await mergeGroups(groups, fake.storage, {
    find: async () => '/x/exists.md',
    carry: async () => { carries++; },
  });

  assert.equal(carries, 0);
});
