import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useFilterRun } from '../ui/hooks/filter-run.ts';
import { renderHook, act, flushAsync, FakeEventSource } from './render-hook.ts';
import type { FilterRunStatus } from '../ui/hooks/run-status-poll.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

function withFakeEventSource(): () => void {
  FakeEventSource.install();
  return () => FakeEventSource.uninstall();
}

test('lädt den Filtermodus aus /api/settings beim Mount', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => ({ filterMode: 'llm' }) } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(({ status }) => useFilterRun(status, () => {}, () => {}, () => {}), { status: null });
  await act(async () => { await flushAsync(); });

  assert.equal(result.current.filterMode, 'llm');
  unmount();
});

test('SSE-Events aus dem Grid-Stream landen in filterSections', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => ({ filterMode: 'regex' }) } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(({ status }) => useFilterRun(status, () => {}, () => {}, () => {}), { status: null });
  await act(async () => { await flushAsync(); });

  act(() => { FakeEventSource.latest().emit({ index: 0, fit: 'matched' }); });

  assert.equal(result.current.filterSections.length, 1);
  unmount();
});

test('status wechselt auf "done" mit neuer runId: refetchJobs + ok-Toast, genau einmal', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => ({ filterMode: 'regex' }) } as Response)) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  let refetchCount = 0;
  const { rerender, unmount } = renderHook(
    ({ status }: { status: FilterRunStatus | null }) => useFilterRun(status, () => {}, (m, k) => said.push([m, k]), () => { refetchCount++; }),
    { status: null as FilterRunStatus | null },
  );
  await act(async () => { await flushAsync(); });

  const done: FilterRunStatus = { status: 'done', runId: 'run-1', result: { matched: 3, offstack: 1, brutal: 2 } };
  rerender({ status: done });
  // Erneutes Rendern mit demselben Status (z.B. durch einen weiteren Poll-Tick mit
  // identischem Objekt) darf den Toast nicht doppelt feuern.
  rerender({ status: { ...done } });

  assert.equal(refetchCount, 1);
  assert.deepEqual(said, [['Filter: 3 Match, 1 Offstack, 2 Brutal', 'ok']]);
  unmount();
});

test('status "error": err-Toast mit der Fehlermeldung', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => ({ filterMode: 'regex' }) } as Response)) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { rerender, unmount } = renderHook(
    ({ status }: { status: FilterRunStatus | null }) => useFilterRun(status, () => {}, (m, k) => said.push([m, k]), () => {}),
    { status: null as FilterRunStatus | null },
  );
  await act(async () => { await flushAsync(); });

  rerender({ status: { status: 'error', runId: 'run-err', error: 'Ollama nicht erreichbar' } });

  assert.deepEqual(said, [['Filter fehlgeschlagen: Ollama nicht erreichbar', 'err']]);
  unmount();
});

test('runFilterNow: postet Modus+Scope, ruft wake() und setzt filterStarting zurück', async (t) => {
  t.after(withFakeEventSource());
  let filterCallBody: unknown;
  let woke = false;
  t.after(withFetch((async (url: string, init?: RequestInit) => {
    if (url === '/api/filter') { filterCallBody = JSON.parse(init!.body as string); return { status: 200 } as Response; }
    return { json: async () => ({ filterMode: 'regex' }) } as Response;
  }) as typeof fetch));

  const { result, unmount } = renderHook(
    ({ status }) => useFilterRun(status, () => { woke = true; }, () => {}, () => {}),
    { status: null },
  );
  await act(async () => { await flushAsync(); });

  await act(async () => { await result.current.runFilterNow(); });

  assert.deepEqual(filterCallBody, { mode: 'regex', scope: 'new' });
  assert.equal(woke, true);
  assert.equal(result.current.filterStarting, false);
  unmount();
});

test('runFilterNow: 409 (läuft bereits) → err-Toast, wake() trotzdem gerufen', async (t) => {
  t.after(withFakeEventSource());
  let woke = false;
  t.after(withFetch((async (url: string) => {
    if (url === '/api/filter') return { status: 409 } as Response;
    return { json: async () => ({ filterMode: 'regex' }) } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { result, unmount } = renderHook(
    ({ status }) => useFilterRun(status, () => { woke = true; }, (m, k) => said.push([m, k]), () => {}),
    { status: null },
  );
  await act(async () => { await flushAsync(); });

  await act(async () => { await result.current.runFilterNow(); });

  assert.deepEqual(said, [['Filter läuft bereits', 'err']]);
  assert.equal(woke, true);
  unmount();
});
