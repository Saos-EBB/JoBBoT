import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useJobEdits } from '../ui/hooks/job-edits.ts';
import { flushAsync } from './render-hook.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

test('saveBrief: Erfolg postet Text und meldet einen ok-Toast', async (t) => {
  const calls: Array<{ url: string; method: string | undefined; body: unknown }> = [];
  t.after(withFetch((async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body });
    return { ok: true } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { saveBrief } = useJobEdits((m, k) => said.push([m, k]), () => {});
  saveBrief('job1', 'neuer Text');
  await flushAsync();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/jobs/job1/brief');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body as string), { text: 'neuer Text' });
  assert.deepEqual(said, [['Anschreiben gespeichert', undefined]]);
});

test('saveBrief: Fehlschlag meldet einen err-Toast', async (t) => {
  t.after(withFetch((async () => ({ ok: false } as Response)) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const { saveBrief } = useJobEdits((m, k) => said.push([m, k]), () => {});
  saveBrief('job1', 'x');
  await flushAsync();

  assert.deepEqual(said, [['Speichern fehlgeschlagen', 'err']]);
});

test('saveEmail: trimmt und speichert eine nicht-leere Adresse, patcht und meldet Erfolg', async (t) => {
  const calls: Array<{ body: unknown }> = [];
  t.after(withFetch((async (_url: string, init?: RequestInit) => {
    calls.push({ body: init?.body });
    return { ok: true } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const patched: Array<[string, unknown]> = [];
  const { saveEmail } = useJobEdits((m, k) => said.push([m, k]), (id, p) => patched.push([id, p]));
  saveEmail('job1', '  a@b.at  ');
  await flushAsync();

  assert.deepEqual(JSON.parse(calls[0].body as string), { email: 'a@b.at' });
  assert.deepEqual(patched, [['job1', { email: 'a@b.at' }]]);
  assert.deepEqual(said, [['Adresse gespeichert', undefined]]);
});

test('saveEmail: leere Eingabe entfernt die Adresse (null statt leerem String)', async (t) => {
  const calls: Array<{ body: unknown }> = [];
  t.after(withFetch((async (_url: string, init?: RequestInit) => {
    calls.push({ body: init?.body });
    return { ok: true } as Response;
  }) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const patched: Array<[string, unknown]> = [];
  const { saveEmail } = useJobEdits((m, k) => said.push([m, k]), (id, p) => patched.push([id, p]));
  saveEmail('job1', '   ');
  await flushAsync();

  assert.deepEqual(JSON.parse(calls[0].body as string), { email: null });
  assert.deepEqual(patched, [['job1', { email: null }]]);
  assert.deepEqual(said, [['Adresse entfernt', undefined]]);
});

test('saveEmail: Fehlschlag meldet err-Toast und patcht nicht', async (t) => {
  t.after(withFetch((async () => ({ ok: false } as Response)) as typeof fetch));

  const said: Array<[string, string | undefined]> = [];
  const patched: Array<[string, unknown]> = [];
  const { saveEmail } = useJobEdits((m, k) => said.push([m, k]), (id, p) => patched.push([id, p]));
  saveEmail('job1', 'a@b.at');
  await flushAsync();

  assert.deepEqual(said, [['Speichern fehlgeschlagen', 'err']]);
  assert.deepEqual(patched, []);
});
