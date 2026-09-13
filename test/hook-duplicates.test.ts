import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useDuplicates } from '../ui/hooks/duplicates.ts';
import { renderHook, act, flushAsync } from './render-hook.ts';
import { toJob } from '../lib/normalize.ts';
import type { DuplicateGroup } from '../lib/duplicates.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

function group(key: string): DuplicateGroup {
  return { key, jobs: [toJob({ source: 'x', url: `https://x/${key}`, title: 't', company: 'c', description: 'd' })] };
}

test('active=true: lädt Gruppen beim Mount, loading-Flag geht danach wieder aus', async (t) => {
  const groups = [group('a'), group('b')];
  t.after(withFetch((async () => ({ json: async () => groups } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(({ active }) => useDuplicates(active, () => {}, () => {}), { active: true });
  await act(async () => { await flushAsync(); });

  assert.deepEqual(result.current.duplicateGroups, groups);
  assert.equal(result.current.duplicatesLoading, false);
  unmount();
});

test('active=false: kein Fetch, duplicateGroups bleibt null', async (t) => {
  let called = false;
  t.after(withFetch((async () => { called = true; return { json: async () => [] } as Response; }) as typeof fetch));

  const { result, unmount } = renderHook(({ active }) => useDuplicates(active, () => {}, () => {}), { active: false });
  await act(async () => { await flushAsync(); });

  assert.equal(called, false);
  assert.equal(result.current.duplicateGroups, null);
  unmount();
});

test('mergeDuplicates(keys): sendet die Keys, meldet Erfolg, lädt neu, leert die Auswahl', async (t) => {
  let mergeCallBody: unknown;
  let loadCalls = 0;
  t.after(withFetch((async (url: string, init?: RequestInit) => {
    if (url === '/api/duplicates/merge') { mergeCallBody = JSON.parse(init!.body as string); return { json: async () => ({ merged: 2 }) } as Response; }
    loadCalls++;
    return { json: async () => [] } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  let refetched = false;
  const { result, unmount } = renderHook(
    ({ active }) => useDuplicates(active, (m, k) => said.push([m, k]), () => { refetched = true; }),
    { active: false },
  );

  act(() => { result.current.setSelectedDupKeys(new Set(['a', 'b'])); });
  await act(async () => { await result.current.mergeDuplicates(['a', 'b']); });

  assert.deepEqual(mergeCallBody, { keys: ['a', 'b'] });
  assert.deepEqual(said, [['2 Duplikat-Gruppe(n) zusammengeführt', 'ok']]);
  assert.equal(result.current.selectedDupKeys.size, 0);
  assert.equal(refetched, true);
  assert.ok(loadCalls >= 1, 'loadDuplicates sollte nach dem Merge erneut laufen');
  unmount();
});

test('mergeDuplicates("all"): sendet { all: true } statt einer Key-Liste', async (t) => {
  let mergeCallBody: unknown;
  t.after(withFetch((async (url: string, init?: RequestInit) => {
    if (url === '/api/duplicates/merge') { mergeCallBody = JSON.parse(init!.body as string); return { json: async () => ({ merged: 5 }) } as Response; }
    return { json: async () => [] } as Response;
  }) as typeof fetch));

  const { result, unmount } = renderHook(({ active }) => useDuplicates(active, () => {}, () => {}), { active: false });
  await act(async () => { await result.current.mergeDuplicates('all'); });

  assert.deepEqual(mergeCallBody, { all: true });
  unmount();
});

test('mergeDuplicates: bei einem Fehler ein err-Toast statt eines Absturzes', async (t) => {
  t.after(withFetch((async (url: string) => {
    if (url === '/api/duplicates/merge') throw new Error('Netzwerk kaputt');
    return { json: async () => [] } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { result, unmount } = renderHook(({ active }) => useDuplicates(active, (m, k) => said.push([m, k]), () => {}), { active: false });

  await act(async () => { await result.current.mergeDuplicates(['a']); });

  assert.equal(said.length, 1);
  assert.match(said[0][0], /Zusammenführen fehlgeschlagen: Netzwerk kaputt/);
  assert.equal(said[0][1], 'err');
  assert.equal(result.current.merging, false);
  unmount();
});
