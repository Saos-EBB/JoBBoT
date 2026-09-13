import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useAttachment } from '../ui/hooks/attachment.ts';
import { renderHook, act, flushAsync } from './render-hook.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

test('active=false: kein Fetch, attachment bleibt undefined', async (t) => {
  let called = false;
  t.after(withFetch((async () => { called = false; throw new Error('sollte nicht aufgerufen werden'); }) as typeof fetch));

  const { result, unmount } = renderHook(({ active }) => useAttachment(active, () => {}), { active: false });
  await act(async () => { await flushAsync(); });

  assert.equal(result.current.attachment, undefined);
  assert.equal(called, false);
  unmount();
});

test('active=true: lädt das Attachment beim Mount', async (t) => {
  const meta = { filename: 'lebenslauf.pdf', size: 1234, uploadedAt: '2026-09-01T00:00:00.000Z' };
  t.after(withFetch((async () => ({ ok: true, json: async () => meta } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(({ active }) => useAttachment(active, () => {}), { active: true });
  await act(async () => { await flushAsync(); });

  assert.deepEqual(result.current.attachment, meta);
  unmount();
});

test('404 (kein Attachment): setzt attachment auf null, nicht auf ein Fehlerobjekt', async (t) => {
  t.after(withFetch((async () => ({ ok: false, json: async () => ({}) } as Response)) as typeof fetch));

  const { result, unmount } = renderHook(({ active }) => useAttachment(active, () => {}), { active: true });
  await act(async () => { await flushAsync(); });

  assert.equal(result.current.attachment, null);
  unmount();
});

test('uploadAttachment: bei Erfolg wird attachment gesetzt und ein ok-Toast gesagt', async (t) => {
  const meta = { filename: 'neu.pdf', size: 42, uploadedAt: '2026-09-13T00:00:00.000Z' };
  const calls: Array<{ method: string | undefined; body: unknown }> = [];
  t.after(withFetch((async (_url: string, init?: RequestInit) => {
    calls.push({ method: init?.method, body: init?.body });
    return { ok: true, json: async () => meta } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { result, unmount } = renderHook(({ active }) => useAttachment(active, (m, k) => said.push([m, k])), { active: false });

  const file = new File(['%PDF'], 'neu.pdf', { type: 'application/pdf' });
  await act(async () => { await result.current.uploadAttachment(file); });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body, file);
  assert.deepEqual(result.current.attachment, meta);
  assert.deepEqual(said, [['Anhang hochgeladen', undefined]]);
  unmount();
});

test('uploadAttachment: bei Fehlschlag ein err-Toast mit Server-Fehlertext', async (t) => {
  t.after(withFetch((async () => ({ ok: false, json: async () => ({ error: 'zu groß' }) } as Response)) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { result, unmount } = renderHook(({ active }) => useAttachment(active, (m, k) => said.push([m, k])), { active: false });

  const file = new File(['x'], 'x.pdf');
  await act(async () => { await result.current.uploadAttachment(file); });

  assert.deepEqual(said, [['zu groß', 'err']]);
  assert.equal(result.current.attachment, undefined);
  unmount();
});

test('removeAttachment: setzt attachment auf null und meldet Erfolg', async (t) => {
  const calls: Array<string | undefined> = [];
  t.after(withFetch((async (_url: string, init?: RequestInit) => {
    calls.push(init?.method);
    return { ok: true } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { result, unmount } = renderHook(({ active }) => useAttachment(active, (m, k) => said.push([m, k])), { active: false });

  await act(async () => { await result.current.removeAttachment(); });

  assert.deepEqual(calls, ['DELETE']);
  assert.equal(result.current.attachment, null);
  assert.deepEqual(said, [['Anhang entfernt', undefined]]);
  unmount();
});
