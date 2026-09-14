import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAnschreibenRun } from '../ui/hooks/anschreiben-run.ts';
import { renderHook, act, flushAsync, FakeEventSource } from './render-hook.ts';
import type { AnschreibenRunStatus } from '../ui/hooks/run-status-poll.ts';
import type { FolderId } from '../lib/folders.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

function withFakeEventSource(): () => void {
  FakeEventSource.install();
  return () => FakeEventSource.uninstall();
}

function setup(status: AnschreibenRunStatus | null) {
  const said: Array<[string, string | undefined]> = [];
  let refetched = false;
  const refreshed: string[] = [];
  let highlighted = new Set<FolderId>();
  let started = false;
  const { result, rerender, unmount } = renderHook(
    ({ status }: { status: AnschreibenRunStatus | null }) => useAnschreibenRun(
      status,
      () => {},
      (m, k) => said.push([m, k]),
      () => { refetched = true; },
      (id) => { refreshed.push(id); },
      (fn) => { highlighted = fn(highlighted); },
      () => { started = true; },
    ),
    { status },
  );
  return { result, rerender, unmount, said, refetchedRef: () => refetched, refreshedRef: () => refreshed, highlightedRef: () => highlighted, startedRef: () => started };
}

test('Grundzustand: anschreibenFits startet mit matched+offstack, kein brutal', (t) => {
  t.after(withFakeEventSource());
  const { result, unmount } = setup(null);
  assert.deepEqual([...result.current.anschreibenFits].sort(), ['matched', 'offstack']);
  unmount();
});

test('SSE-Events landen in anschreibenSections', async (t) => {
  t.after(withFakeEventSource());
  const { result, unmount } = setup(null);
  await act(async () => { await flushAsync(); });

  act(() => { FakeEventSource.latest().emit({ index: 0, ok: true }); });

  assert.equal(result.current.anschreibenSections.length, 1);
  unmount();
});

test('fertiges Item im SSE-Stream lädt genau diesen Job einzeln nach (nicht error-Items)', async (t) => {
  t.after(withFakeEventSource());
  const { refreshedRef, unmount } = setup(null);
  await act(async () => { await flushAsync(); });

  act(() => FakeEventSource.latest().emit({
    section: 'run1', sectionLabel: 'Anschreiben', row: 'job1',
    items: [{ id: 'job1', tooltip: 'x', state: 'done' }, { id: 'job2', tooltip: 'y', state: 'error' }],
  }));

  assert.deepEqual(refreshedRef(), ['job1']);
  unmount();
});

test('status "done": Toast, refetch, und nur die Ordner mit echtem Zuwachs werden markiert', async (t) => {
  t.after(withFakeEventSource());
  const { rerender, said, refetchedRef, highlightedRef, unmount } = setup(null);
  await act(async () => { await flushAsync(); });

  rerender({ status: { status: 'done', runId: 'r1', result: { generated: 5, skipped: 1, emailsFound: 3, mailGenerated: 2, nomailGenerated: 0 } } });

  assert.deepEqual(said, [['Anschreiben: 5 generiert, 1 übersprungen, 3 E-Mails gefunden', 'ok']]);
  assert.equal(refetchedRef(), true);
  assert.deepEqual([...highlightedRef()], ['mail/entwurf']);
  unmount();
});

test('status "stopped": eigener Toasttext, refetch trotzdem', async (t) => {
  t.after(withFakeEventSource());
  const { rerender, said, refetchedRef, unmount } = setup(null);
  await act(async () => { await flushAsync(); });

  rerender({ status: { status: 'stopped', runId: 'r2', result: { generated: 2, skipped: 0, emailsFound: 1, mailGenerated: 0, nomailGenerated: 1 } } });

  assert.deepEqual(said, [['Anschreiben abgebrochen: 2 generiert, 1 E-Mails gefunden', 'ok']]);
  assert.equal(refetchedRef(), true);
  unmount();
});

test('status "error": err-Toast, keine Ordner-Markierung', async (t) => {
  t.after(withFakeEventSource());
  const { rerender, said, highlightedRef, unmount } = setup(null);
  await act(async () => { await flushAsync(); });

  rerender({ status: { status: 'error', runId: 'r3', error: 'Ollama down' } });

  assert.deepEqual(said, [['Anschreiben fehlgeschlagen: Ollama down', 'err']]);
  assert.deepEqual([...highlightedRef()], []);
  unmount();
});

test('runAnschreibenNow: leere Auswahl macht gar nichts', async (t) => {
  t.after(withFakeEventSource());
  let called = false;
  t.after(withFetch((async () => { called = true; return { status: 200 } as Response; }) as typeof fetch));
  const { result, startedRef, unmount } = setup(null);

  await act(async () => { await result.current.runAnschreibenNow([]); });

  assert.equal(called, false);
  assert.equal(startedRef(), false);
  unmount();
});

test('runAnschreibenNow: postet jobIds, ruft onStarted() und wake() bei Erfolg', async (t) => {
  t.after(withFakeEventSource());
  let body: unknown;
  t.after(withFetch((async (_url: string, init?: RequestInit) => {
    body = JSON.parse(init!.body as string);
    return { status: 200 } as Response;
  }) as typeof fetch));
  const { result, startedRef, unmount } = setup(null);

  await act(async () => { await result.current.runAnschreibenNow(['j1', 'j2']); });

  assert.deepEqual(body, { jobIds: ['j1', 'j2'] });
  assert.equal(startedRef(), true);
  assert.equal(result.current.anschreibenStarting, false);
  unmount();
});

test('runAnschreibenNow: 409 → err-Toast, onStarted() NICHT gerufen', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ status: 409 } as Response)) as typeof fetch));
  const { result, said, startedRef, unmount } = setup(null);

  await act(async () => { await result.current.runAnschreibenNow(['j1']); });

  assert.deepEqual(said, [['Anschreiben-Lauf läuft bereits', 'err']]);
  assert.equal(startedRef(), false);
  unmount();
});

test('stopAnschreibenNow: 409 (kein aktiver Lauf) → err-Toast', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ status: 409 } as Response)) as typeof fetch));
  const { result, said, unmount } = setup(null);

  await act(async () => { await result.current.stopAnschreibenNow(); });

  assert.deepEqual(said, [['Kein Anschreiben-Lauf aktiv', 'err']]);
  unmount();
});

test('stopAnschreibenNow: Erfolg meldet nichts selbst (der Poll-Tick übernimmt den Toast)', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ status: 200 } as Response)) as typeof fetch));
  const { result, said, unmount } = setup(null);

  await act(async () => { await result.current.stopAnschreibenNow(); });

  assert.deepEqual(said, []);
  unmount();
});
