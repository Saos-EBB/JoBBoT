import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useScrapeRun } from '../ui/hooks/scrape-run.ts';
import { renderHook, act, flushAsync, FakeEventSource } from './render-hook.ts';
import type { ScrapeStatus } from '../ui/hooks/run-status-poll.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

function withFakeEventSource(): () => void {
  FakeEventSource.install();
  return () => FakeEventSource.uninstall();
}

function withWindow(): { restore: () => void; dispatched: CustomEvent[] } {
  const dispatched: CustomEvent[] = [];
  const fakeWindow = { dispatchEvent: (e: CustomEvent) => { dispatched.push(e); } };
  (globalThis as { window?: unknown }).window = fakeWindow;
  return { dispatched, restore: () => { delete (globalThis as { window?: unknown }).window; } };
}

function viewRef(current: string): { current: string } {
  return { current };
}

test('lädt die verfügbaren Quellen beim Mount und wählt anfangs alle aus', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => ['karriere', 'ams', 'linkedin'] } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(
    ({ status }) => useScrapeRun(status, () => {}, () => {}, () => {}, viewRef('scrape')),
    { status: null as ScrapeStatus | null },
  );
  await act(async () => { await flushAsync(); });

  assert.deepEqual(result.current.scrapeSources, ['karriere', 'ams', 'linkedin']);
  assert.deepEqual([...result.current.selectedSources].sort(), ['ams', 'karriere', 'linkedin']);
  unmount();
});

test('SSE-Event: landet in scrapeSections, feuert tschobbo:unit nur wenn view==="scrape"', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => [] } as Response)) as typeof fetch));
  const w = withWindow();
  t.after(w.restore);

  const { result, unmount } = renderHook(
    ({ status }) => useScrapeRun(status, () => {}, () => {}, () => {}, viewRef('scrape')),
    { status: null as ScrapeStatus | null },
  );
  await act(async () => { await flushAsync(); });

  act(() => { FakeEventSource.latest().emit({ index: 0, source: 'karriere' }); });

  assert.equal(result.current.scrapeSections.length, 1);
  assert.equal(w.dispatched.length, 1);
  unmount();
});

test('SSE-Event: kein tschobbo:unit, wenn eine andere Ansicht aktiv ist', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => [] } as Response)) as typeof fetch));
  const w = withWindow();
  t.after(w.restore);

  renderHook(
    ({ status }) => useScrapeRun(status, () => {}, () => {}, () => {}, viewRef('jobs')),
    { status: null as ScrapeStatus | null },
  );
  await act(async () => { await flushAsync(); });

  act(() => { FakeEventSource.latest().emit({ index: 0, source: 'karriere' }); });

  assert.equal(w.dispatched.length, 0);
});

test('status "done": Toast nennt neu/dedup, offline/zurückgeholt nur wenn > 0, feuert tschobbo:scrape-done', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => [] } as Response)) as typeof fetch));
  const w = withWindow();
  t.after(w.restore);

  const said: Array<[string, string | undefined]> = [];
  let refetched = false;
  const { rerender, unmount } = renderHook(
    ({ status }: { status: ScrapeStatus | null }) => useScrapeRun(status, () => {}, (m, k) => said.push([m, k]), () => { refetched = true; }, viewRef('scrape')),
    { status: null as ScrapeStatus | null },
  );
  await act(async () => { await flushAsync(); });

  rerender({ status: { status: 'done', runId: 'r1', sources: {}, result: { newTotal: 4, skipTotal: 2, offlineTotal: 0, backTotal: 0, perSource: [] } } });
  assert.deepEqual(said, [['Scrape: 4 neu, 2 dedup', 'ok']]);
  assert.equal(refetched, true);
  assert.deepEqual(w.dispatched.map(e => e.type), ['tschobbo:scrape-done']);
  unmount();
});

test('status "done": offline/zurückgeholt werden angehängt, wenn > 0', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => [] } as Response)) as typeof fetch));
  t.after(withWindow().restore);

  const said: Array<[string, string | undefined]> = [];
  const { rerender, unmount } = renderHook(
    ({ status }: { status: ScrapeStatus | null }) => useScrapeRun(status, () => {}, (m, k) => said.push([m, k]), () => {}, viewRef('scrape')),
    { status: null as ScrapeStatus | null },
  );
  await act(async () => { await flushAsync(); });

  rerender({ status: { status: 'done', runId: 'r2', sources: {}, result: { newTotal: 1, skipTotal: 0, offlineTotal: 3, backTotal: 2, perSource: [] } } });
  assert.deepEqual(said, [['Scrape: 1 neu, 0 dedup, 3 offline archiviert, 2 zurückgeholt', 'ok']]);
  unmount();
});

test('status "error": err-Toast mit Fehlermeldung, feuert trotzdem tschobbo:scrape-done', async (t) => {
  t.after(withFakeEventSource());
  t.after(withFetch((async () => ({ json: async () => [] } as Response)) as typeof fetch));
  const w = withWindow();
  t.after(w.restore);

  const said: Array<[string, string | undefined]> = [];
  const { rerender, unmount } = renderHook(
    ({ status }: { status: ScrapeStatus | null }) => useScrapeRun(status, () => {}, (m, k) => said.push([m, k]), () => {}, viewRef('scrape')),
    { status: null as ScrapeStatus | null },
  );
  await act(async () => { await flushAsync(); });

  rerender({ status: { status: 'error', runId: 'r3', sources: {}, error: 'karriere.at 500' } });
  assert.deepEqual(said, [['Scrape fehlgeschlagen: karriere.at 500', 'err']]);
  assert.deepEqual(w.dispatched.map(e => e.type), ['tschobbo:scrape-done']);
  unmount();
});

test('runScrapeNow: postet die ausgewählten Quellen, ruft wake(), räumt scrapeSections', async (t) => {
  t.after(withFakeEventSource());
  let scrapeBody: unknown;
  let woke = false;
  t.after(withFetch((async (url: string, init?: RequestInit) => {
    if (url === '/api/scrape') { scrapeBody = JSON.parse(init!.body as string); return { status: 200 } as Response; }
    return { json: async () => ['karriere', 'ams'] } as Response;
  }) as typeof fetch));

  const { result, unmount } = renderHook(
    ({ status }) => useScrapeRun(status, () => { woke = true; }, () => {}, () => {}, viewRef('scrape')),
    { status: null as ScrapeStatus | null },
  );
  await act(async () => { await flushAsync(); });

  await act(async () => { await result.current.runScrapeNow(); });

  assert.deepEqual((scrapeBody as { sources: string[] }).sources.sort(), ['ams', 'karriere']);
  assert.equal(woke, true);
  assert.equal(result.current.scrapeStarting, false);
  assert.deepEqual(result.current.scrapeSections, []);
  unmount();
});
