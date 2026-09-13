import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useCcAddress } from '../ui/hooks/cc.ts';
import { renderHook, act, flushAsync } from './render-hook.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

test('active=true: lädt cc und spiegelt es in ccInput', async (t) => {
  t.after(withFetch((async () => ({ json: async () => ({ email: 'cc@example.com' }) } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(({ active }) => useCcAddress(active, () => {}), { active: true });
  await act(async () => { await flushAsync(); });

  assert.equal(result.current.cc, 'cc@example.com');
  assert.equal(result.current.ccInput, 'cc@example.com');
  unmount();
});

test('active=true, kein CC gesetzt: cc/ccInput bleiben leer statt null-String', async (t) => {
  t.after(withFetch((async () => ({ json: async () => ({ email: null }) } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(({ active }) => useCcAddress(active, () => {}), { active: true });
  await act(async () => { await flushAsync(); });

  assert.equal(result.current.cc, null);
  assert.equal(result.current.ccInput, '');
  unmount();
});

test('active=false: kein Fetch', async (t) => {
  let called = false;
  t.after(withFetch((async () => { called = true; return { json: async () => ({ email: null }) } as Response; }) as typeof fetch));

  renderHook(({ active }) => useCcAddress(active, () => {}), { active: false });
  await act(async () => { await flushAsync(); });

  assert.equal(called, false);
});

test('saveCcNow: speichert und meldet Erfolg', async (t) => {
  const calls: unknown[] = [];
  t.after(withFetch((async (_url: string, init?: RequestInit) => {
    calls.push(init?.body ? JSON.parse(init.body as string) : null);
    return { ok: true, json: async () => ({ email: 'neu@example.com' }) } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { result, unmount } = renderHook(({ active }) => useCcAddress(active, (m, k) => said.push([m, k])), { active: false });

  await act(async () => { await result.current.saveCcNow('neu@example.com'); });

  assert.deepEqual(calls, [{ email: 'neu@example.com' }]);
  assert.equal(result.current.cc, 'neu@example.com');
  assert.deepEqual(said, [['CC gespeichert', undefined]]);
  unmount();
});

test('saveCcNow: bei Fehlschlag ein err-Toast, cc bleibt unverändert', async (t) => {
  t.after(withFetch((async () => ({ ok: false, json: async () => ({ error: 'ungültig' }) } as Response)) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { result, unmount } = renderHook(({ active }) => useCcAddress(active, (m, k) => said.push([m, k])), { active: false });

  await act(async () => { await result.current.saveCcNow('kaputt'); });

  assert.equal(result.current.cc, undefined);
  assert.deepEqual(said, [['ungültig', 'err']]);
  unmount();
});

test('removeCc: setzt cc und ccInput zurück', async (t) => {
  t.after(withFetch((async () => ({ ok: true } as Response)) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { result, unmount } = renderHook(({ active }) => useCcAddress(active, (m, k) => said.push([m, k])), { active: false });

  act(() => { result.current.setCcInput('tippfehler@'); });
  await act(async () => { await result.current.removeCc(); });

  assert.equal(result.current.cc, null);
  assert.equal(result.current.ccInput, '');
  assert.deepEqual(said, [['CC entfernt', undefined]]);
  unmount();
});
