import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useMailSync } from '../ui/hooks/mail-sync.ts';
import { renderHook, act } from './render-hook.ts';
import { HISTORY_START } from '../lib/calendar.ts';

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

function setup() {
  const said: Array<[string, string | undefined]> = [];
  const patched: Array<[string, unknown]> = [];
  let refetched = false;
  let calendarEvents: unknown = undefined;
  let detailOpen: boolean | undefined;
  const { result, unmount } = renderHook(
    () => useMailSync(
      (m, k) => said.push([m, k]),
      () => { refetched = true; },
      (events) => { calendarEvents = events; },
      (id, p) => patched.push([id, p]),
      (open) => { detailOpen = open; },
    ),
    undefined,
  );
  return { said, patched, result, unmount, refetchedRef: () => refetched, calendarEventsRef: () => calendarEvents, detailOpenRef: () => detailOpen };
}

test('fetchReplies: Erfolg mit Treffern löst refetchJobs aus', async (t) => {
  t.after(withFetch((async () => ({ ok: true, json: async () => ({ checked: 5, matched: 2, ambiguous: [] }) } as Response)) as typeof fetch));
  const { said, result, refetchedRef, unmount } = setup();

  await act(async () => { await result.current.fetchReplies(); });

  assert.deepEqual(said, [['Antworten-Abruf: 2 von 5 zugeordnet', 'ok']]);
  assert.equal(refetchedRef(), true);
  assert.equal(result.current.repliesFetching, false);
  unmount();
});

test('fetchReplies: mehrdeutige Antworten landen in ambiguousReplies + im Toast', async (t) => {
  const ambiguous = [{ reply: { from: 'x@acme.at', subject: 'Ihre Bewerbung', date: '2026-07-10T00:00:00.000Z' }, candidates: [{ id: 'a', title: 'Junior', company: 'Acme' }, { id: 'b', title: 'Senior', company: 'Acme' }] }];
  t.after(withFetch((async () => ({ ok: true, json: async () => ({ checked: 4, matched: 0, ambiguous }) } as Response)) as typeof fetch));
  const { said, result, unmount } = setup();

  await act(async () => { await result.current.fetchReplies(); });

  assert.deepEqual(said, [['Antworten-Abruf: 0 von 4 zugeordnet, 1 zum manuellen Zuordnen', 'ok']]);
  assert.equal(result.current.ambiguousReplies.length, 1);
  assert.equal(result.current.ambiguousReplies[0].candidates.length, 2);
  unmount();
});

test('fetchReplies: ohne Treffer kein refetchJobs', async (t) => {
  t.after(withFetch((async () => ({ ok: true, json: async () => ({ checked: 3, matched: 0, ambiguous: [] }) } as Response)) as typeof fetch));
  const { result, refetchedRef, unmount } = setup();

  await act(async () => { await result.current.fetchReplies(); });

  assert.equal(refetchedRef(), false);
  unmount();
});

test('fetchReplies: Server-Fehler → err-Toast mit dem Server-Fehlertext', async (t) => {
  t.after(withFetch((async () => ({ ok: false, json: async () => ({ error: 'IMAP down' }) } as Response)) as typeof fetch));
  const { said, result, unmount } = setup();

  await act(async () => { await result.current.fetchReplies(); });

  assert.deepEqual(said, [['Antworten-Abruf fehlgeschlagen: IMAP down', 'err']]);
  unmount();
});

test('syncGmail: meldet jede Stufe und lädt bei Treffern Jobs + Kalender neu', async (t) => {
  const calendarEvents = [{ id: 'ev1' }];
  t.after(withFetch((async (url: string) => {
    if (url === '/api/calendar') return { json: async () => calendarEvents } as Response;
    return {
      ok: true,
      json: async () => ({ seit: null, sentGescannt: 10, markiert: 4, sentGefuellt: 3, ohneJob: 1, replyGefuellt: 2 }),
    } as Response;
  }) as typeof fetch));
  const { said, result, refetchedRef, calendarEventsRef, unmount } = setup();

  await act(async () => { await result.current.syncGmail(); });

  assert.equal(said.length, 1);
  assert.match(said[0][0], new RegExp(`^Gmail-Sync ab ${HISTORY_START}: 10 gesendet gelesen`));
  assert.equal(refetchedRef(), true);
  assert.deepEqual(calendarEventsRef(), calendarEvents);
  assert.equal(result.current.gmailSyncing, false);
  unmount();
});

test('syncGmail: 0 Treffer überall → kein refetch, kein Kalenderabruf', async (t) => {
  t.after(withFetch((async () => ({
    ok: true,
    json: async () => ({ seit: '2026-08-01', sentGescannt: 0, markiert: 0, sentGefuellt: 0, ohneJob: 0, replyGefuellt: 0 }),
  } as Response)) as typeof fetch));
  const { result, refetchedRef, calendarEventsRef, unmount } = setup();

  await act(async () => { await result.current.syncGmail(); });

  assert.equal(refetchedRef(), false);
  assert.equal(calendarEventsRef(), undefined);
  unmount();
});

test('runFollowUps: patcht jeden erfolgreichen Job, leert die Auswahl danach', async (t) => {
  t.after(withFetch((async (url: string) => ({
    ok: true,
    json: async () => ({ id: url.split('/')[3], followUps: ['x'] }),
  } as Response)) as typeof fetch));
  const { said, patched, result, unmount } = setup();

  act(() => { result.current.setFollowUpSelection(new Set(['j1', 'j2'])); });
  await act(async () => { await result.current.runFollowUps('draft'); });

  assert.equal(patched.length, 2);
  assert.equal(result.current.followUpSelection.size, 0);
  assert.equal(result.current.followUpBusy, false);
  assert.deepEqual(said, [['2 Nachfass als Entwurf angelegt', undefined]]);
  unmount();
});

test('runFollowUps: leere Auswahl macht gar nichts', async (t) => {
  let called = false;
  t.after(withFetch((async () => { called = true; return { ok: true, json: async () => ({}) } as Response; }) as typeof fetch));
  const { result, unmount } = setup();

  await act(async () => { await result.current.runFollowUps('sent'); });

  assert.equal(called, false);
  unmount();
});

test('createDraft: bei Erfolg patcht Status auf postausgang und schließt das Detail', async (t) => {
  t.after(withFetch((async () => ({ ok: true } as Response)) as typeof fetch));
  const { said, patched, result, detailOpenRef, unmount } = setup();

  await act(async () => { await result.current.createDraft('j1', 'firma@example.com'); });

  assert.deepEqual(patched, [['j1', { status: 'postausgang' }]]);
  assert.equal(detailOpenRef(), false);
  assert.deepEqual(said, [['Entwurf für firma@example.com erstellt', undefined]]);
  unmount();
});

test('sendDirect: bei Fehlschlag ein err-Toast, kein Patch', async (t) => {
  t.after(withFetch((async () => ({ ok: false, json: async () => ({ error: 'SMTP down' }) } as Response)) as typeof fetch));
  const { said, patched, result, unmount } = setup();

  await act(async () => { await result.current.sendDirect('j1'); });

  assert.deepEqual(patched, []);
  assert.deepEqual(said, [['SMTP down', 'err']]);
  unmount();
});
