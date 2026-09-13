import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useRunStatusPoll } from '../ui/hooks/run-status-poll.ts';
import { renderHook, act, flushAsync } from './render-hook.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

test('erster Tick füllt alle drei Status aus fetch', async (t) => {
  t.after(withFetch((async (url: string) => ({
    json: async () => ({ status: url.includes('scrape') ? 'running' : 'done' }),
  } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(() => useRunStatusPoll(), undefined);
  await act(async () => { await flushAsync(); });

  assert.deepEqual(result.current.scrapeStatus, { status: 'running' });
  assert.deepEqual(result.current.filterStatus, { status: 'done' });
  assert.deepEqual(result.current.anschreibenStatus, { status: 'done' });
  unmount();
});

test('solange ein Lauf "running" ist, wird nach 1500ms erneut gepollt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fetchCalls = 0;
  t.after(withFetch((async () => { fetchCalls++; return { json: async () => ({ status: 'running' }) } as Response; }) as typeof fetch));

  const { unmount } = renderHook(() => useRunStatusPoll(), undefined);
  await act(async () => { await flushAsync(); });
  const afterMount = fetchCalls;
  assert.equal(afterMount, 3); // scrape+filter+anschreiben, ein Tick

  await act(async () => { t.mock.timers.tick(1500); await flushAsync(); });
  assert.equal(fetchCalls, afterMount + 3, 'ein zweiter Tick sollte gefeuert haben');

  unmount();
});

test('sind alle drei fertig, wird nicht erneut gepollt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fetchCalls = 0;
  t.after(withFetch((async () => { fetchCalls++; return { json: async () => ({ status: 'done' }) } as Response; }) as typeof fetch));

  const { unmount } = renderHook(() => useRunStatusPoll(), undefined);
  await act(async () => { await flushAsync(); });
  const afterMount = fetchCalls;

  await act(async () => { t.mock.timers.tick(1500); await flushAsync(); });
  assert.equal(fetchCalls, afterMount, 'kein weiterer Tick, wenn nichts mehr läuft');

  unmount();
});

test('unmount stoppt die Schleife — kein weiterer Fetch nach dem Cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fetchCalls = 0;
  t.after(withFetch((async () => { fetchCalls++; return { json: async () => ({ status: 'running' }) } as Response; }) as typeof fetch));

  const { unmount } = renderHook(() => useRunStatusPoll(), undefined);
  await act(async () => { await flushAsync(); });
  const afterMount = fetchCalls;

  unmount();
  t.mock.timers.tick(1500);
  await flushAsync();
  assert.equal(fetchCalls, afterMount, 'nach unmount darf kein Tick mehr fetchen');
});

test('wake() löst sofort einen neuen Tick aus, ohne auf die 1500ms zu warten', async (t) => {
  let fetchCalls = 0;
  t.after(withFetch((async () => { fetchCalls++; return { json: async () => ({ status: 'done' }) } as Response; }) as typeof fetch));

  const { result, unmount } = renderHook(() => useRunStatusPoll(), undefined);
  await act(async () => { await flushAsync(); });
  const afterMount = fetchCalls;

  await act(async () => { result.current.wake(); await flushAsync(); });
  assert.equal(fetchCalls, afterMount + 3);
  unmount();
});

test('ein fehlschlagender Fetch bricht die Schleife nicht ab, sondern versucht es nach 1500ms erneut', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let fetchCalls = 0;
  t.after(withFetch((async () => { fetchCalls++; throw new Error('Server kurz weg'); }) as typeof fetch));

  const { unmount } = renderHook(() => useRunStatusPoll(), undefined);
  await act(async () => { await flushAsync(); });
  const afterMount = fetchCalls;

  await act(async () => { t.mock.timers.tick(1500); await flushAsync(); });
  assert.ok(fetchCalls > afterMount, 'sollte nach einem Fehler weiter pollen statt stillzustehen');

  unmount();
});
