import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useJobMutations, type JobMutationsDeps } from '../ui/hooks/job-mutations.ts';
import type { JobWithBrief } from '../ui/app.tsx';
import { toJob } from '../lib/normalize.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

const okFetch = () => (async () => ({ ok: true } as Response)) as typeof fetch;

function jwb(overrides: Partial<JobWithBrief> = {}): JobWithBrief {
  return { ...toJob({ source: 's', url: `https://x/${overrides.id ?? '1'}`, title: 'T', company: 'C', description: '' }), ...overrides } as JobWithBrief;
}

// Deps mit Recordern; jobs/selectedJobIds pro Test überschreibbar.
function deps(overrides: Partial<JobMutationsDeps> = {}) {
  const said: [string, string | undefined][] = [];
  const patched: [string, Partial<JobWithBrief>][] = [];
  const detail: boolean[] = [];
  const anschreiben: string[][] = [];
  let jobsHolder: JobWithBrief[] = overrides.jobs ?? [];
  const selCleared: number[] = [];
  const base: JobMutationsDeps = {
    jobs: jobsHolder,
    selectedJobIds: new Set(),
    say: (m, k) => said.push([m, k]),
    patch: (id, p) => patched.push([id, p]),
    setJobs: (u) => { jobsHolder = typeof u === 'function' ? (u as (j: JobWithBrief[]) => JobWithBrief[])(jobsHolder) : u; },
    setSelectedJobIds: () => selCleared.push(1),
    setDetailOpen: (o) => detail.push(o),
    runAnschreiben: (ids) => anschreiben.push(ids),
    ...overrides,
  };
  return { base, said, patched, detail, anschreiben, selCleared, jobs: () => jobsHolder };
}

test('move: Erfolg → status posten, patch, Toast, Detail schließen', async (t) => {
  const calls: { url: string; body: unknown }[] = [];
  t.after(withFetch((async (url: string, init?: RequestInit) => { calls.push({ url, body: init?.body }); return { ok: true } as Response; }) as typeof fetch));
  const d = deps();
  const { move } = useJobMutations(d.base);
  await move('job1', 'freigegeben', 'Freigegeben');
  assert.deepEqual(JSON.parse(calls[0].body as string), { status: 'freigegeben' });
  assert.deepEqual(d.patched, [['job1', { status: 'freigegeben' }]]);
  assert.deepEqual(d.said, [['Freigegeben', undefined]]);
  assert.deepEqual(d.detail, [false]);
});

test('move: Fehlschlag → err-Toast, kein patch, Detail bleibt', async (t) => {
  t.after(withFetch((async () => ({ ok: false } as Response)) as typeof fetch));
  const d = deps();
  const { move } = useJobMutations(d.base);
  await move('job1', 'freigegeben', 'Freigegeben');
  assert.deepEqual(d.said, [['Speichern fehlgeschlagen', 'err']]);
  assert.deepEqual(d.patched, []);
  assert.deepEqual(d.detail, []);
});

test('saveFit: Erfolg patcht, Fehlschlag meldet err', async (t) => {
  const d1 = deps();
  const restore1 = withFetch(okFetch());
  const { saveFit } = useJobMutations(d1.base);
  await saveFit('job1', 'matched');
  restore1();
  assert.deepEqual(d1.patched, [['job1', { fit: 'matched' }]]);

  const d2 = deps();
  t.after(withFetch((async () => ({ ok: false } as Response)) as typeof fetch));
  const { saveFit: saveFit2 } = useJobMutations(d2.base);
  await saveFit2('job1', 'matched');
  assert.deepEqual(d2.said, [['Speichern fehlgeschlagen', 'err']]);
  assert.deepEqual(d2.patched, []);
});

test('regenerate: brutal/kein fit → err, kein Fetch, kein Lauf', async (t) => {
  let fetched = false;
  t.after(withFetch((async () => { fetched = true; return { ok: true } as Response; }) as typeof fetch));
  const d = deps();
  const { regenerate } = useJobMutations(d.base);
  await regenerate(jwb({ id: 'j', fit: 'brutal' }));
  assert.equal(fetched, false);
  assert.equal(d.anschreiben.length, 0);
  assert.equal(d.said[0][1], 'err');
});

test('regenerate: gültiger fit → status triaged posten, patch, Lauf starten', async (t) => {
  const calls: unknown[] = [];
  t.after(withFetch((async (_u: string, init?: RequestInit) => { calls.push(init?.body); return { ok: true } as Response; }) as typeof fetch));
  const d = deps();
  const { regenerate } = useJobMutations(d.base);
  await regenerate(jwb({ id: 'j', fit: 'matched' }));
  assert.deepEqual(JSON.parse(calls[0] as string), { status: 'triaged' });
  assert.deepEqual(d.patched, [['j', { status: 'triaged' }]]);
  assert.deepEqual(d.anschreiben, [['j']]);
});

test('runBulk: postet für jeden ausgewählten Job, aktualisiert nur Erfolge, leert Auswahl', async (t) => {
  const a = jwb({ id: 'a' });
  const b = jwb({ id: 'b' });
  // b schlägt fehl.
  t.after(withFetch((async (url: string) => ({ ok: !url.endsWith('/b') } as Response)) as typeof fetch));
  const d = deps({ jobs: [a, b], selectedJobIds: new Set(['a', 'b']) });
  const { runBulk } = useJobMutations(d.base);
  await runBulk(() => ({ status: 'freigegeben' }), 'freigegeben');

  assert.equal(d.jobs().find(j => j.id === 'a')?.status, 'freigegeben', 'Erfolg übernommen');
  assert.notEqual(d.jobs().find(j => j.id === 'b')?.status, 'freigegeben', 'Fehlschlag nicht übernommen');
  assert.equal(d.selCleared.length, 1, 'Auswahl geleert');
  assert.deepEqual(d.said, [['1 freigegeben, 1 fehlgeschlagen', 'err']]);
});

test('runBulk: leere Auswahl → nichts passiert', async (t) => {
  let fetched = false;
  t.after(withFetch((async () => { fetched = true; return { ok: true } as Response; }) as typeof fetch));
  const d = deps({ selectedJobIds: new Set() });
  const { runBulk } = useJobMutations(d.base);
  await runBulk(() => ({ status: 'freigegeben' }), 'freigegeben');
  assert.equal(fetched, false);
  assert.deepEqual(d.said, []);
});
