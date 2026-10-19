import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, rmTmp } from './helpers.ts';
import { JsonStore } from '../storage/json-store.ts';
import { toJob } from '../lib/normalize.ts';
import { runGmailSync, replyScanSince, fetchAndFillReplies, type GmailSyncDeps } from '../lib/gmail-sync.ts';
import { regexReplyClassifier } from '../lib/reply-kind.ts';
import type { Job } from '../scrapers/interface.ts';
import type { SentMail, InboxReply } from '../mail/gmail.ts';
import type { MailEvent } from '../lib/mail-events.ts';

function offenerJob(overrides: Partial<{ title: string; company: string; email: string | null; sentAt: string | null; replyReceivedAt: string | null; status: Job['status'] }> = {}): Job {
  const job = toJob({
    source: 'karriere.at',
    url: 'https://www.karriere.at/jobs/123',
    title: overrides.title ?? 'Junior Developer',
    company: overrides.company ?? 'Acme',
    description: 'Anforderungen: TypeScript-Kenntnisse.',
  });
  return {
    ...job,
    status: overrides.status ?? 'gesendet',
    email: overrides.email === undefined ? 'office@acme.at' : overrides.email,
    sentAt: overrides.sentAt === undefined ? null : overrides.sentAt,
    replyReceivedAt: overrides.replyReceivedAt === undefined ? null : overrides.replyReceivedAt,
  };
}

function sentMail(overrides: Partial<SentMail> = {}): SentMail {
  return { to: ['office@acme.at'], subject: 'Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-05'), labels: ['Bewerbung'], ...overrides };
}

function fakeDeps(overrides: Partial<GmailSyncDeps> = {}): GmailSyncDeps & { savedEvents: MailEvent[][] } {
  const savedEvents: MailEvent[][] = [];
  return {
    fetchSentMails: async () => [],
    fetchInboxReplies: async () => [],
    saveMailEvents: async events => { savedEvents.push(events); },
    // Nie das echte JEV (würde den llama-server starten) — die Regex-Option reicht für
    // die Sync-Logik; JEV selbst testet test/reply-kind-jev.test.ts.
    classifyReply: regexReplyClassifier,
    savedEvents,
    ...overrides,
  };
}

test('markiert und ordnet eine gelabelte Sent-Mail einem offenen Job zu, setzt sentAt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ sentAt: null });
  await storage.save(job);

  const deps = fakeDeps({ fetchSentMails: async () => [sentMail()] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.sentGescannt, 1);
  assert.equal(result.markiert, 1);
  assert.equal(result.sentGefuellt, 1);
  assert.equal(result.ohneJob, 0);

  const updated = await storage.get(job.id);
  assert.equal(updated?.sentAt, new Date('2026-07-05').toISOString());
});

test('ueberschreibt ein vorhandenes sentAt nicht (fuellt nur Luecken)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const echtesSentAt = '2026-06-01T00:00:00.000Z';
  const job = offenerJob({ sentAt: echtesSentAt });
  await storage.save(job);

  const deps = fakeDeps({ fetchSentMails: async () => [sentMail()] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.sentGefuellt, 0);
  const updated = await storage.get(job.id);
  assert.equal(updated?.sentAt, echtesSentAt);
});

test('ohne Label: Bewerbungs-Betreff zählt automatisch und wird zugeordnet', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ sentAt: null });
  await storage.save(job);

  const deps = fakeDeps({ fetchSentMails: async () => [sentMail({ labels: [] })] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.markiert, 1);
  assert.equal(result.sentGefuellt, 1);
  assert.ok((await storage.get(job.id))?.sentAt);
});

test('private Mail ohne Label und ohne "Bewerbung" im Betreff zählt nicht und wird nicht zugeordnet', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ sentAt: null });
  await storage.save(job);

  const deps = fakeDeps({ fetchSentMails: async () => [sentMail({ subject: 'Krankmeldung', labels: [] })] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.sentGescannt, 1);
  assert.equal(result.markiert, 0);
  assert.equal(result.sentGefuellt, 0);
  assert.equal((await storage.get(job.id))?.sentAt, null);
  assert.deepEqual(deps.savedEvents, [[]]);
});

test('gelabelte Mail ohne zuordenbaren Job landet in ohneJob und wird als Mail-Event gespeichert', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);

  const verwaist = sentMail({ to: ['jemand@fremd.at'], subject: 'Bewerbung als Irgendwas bei Fremd GmbH' });
  const deps = fakeDeps({ fetchSentMails: async () => [verwaist] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.ohneJob, 1);
  assert.equal(deps.savedEvents.length, 1);
  assert.equal(deps.savedEvents[0].length, 1);
  assert.equal(deps.savedEvents[0][0].company, 'Fremd GmbH');
});

test('ordnet eine Antwort einem bereits gesendeten Job zu und setzt replyReceivedAt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ status: 'gesendet', sentAt: '2026-07-01T00:00:00.000Z', replyReceivedAt: null });
  await storage.save(job);

  const reply: InboxReply = { from: 'office@acme.at', subject: 'Re: Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-10') };
  const deps = fakeDeps({ fetchInboxReplies: async () => [reply] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.replyGescannt, 1);
  assert.equal(result.replyGefuellt, 1);
  const updated = await storage.get(job.id);
  assert.equal(updated?.replyReceivedAt, reply.date.toISOString());
});

test('ueberschreibt ein vorhandenes replyReceivedAt nicht', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const echteAntwort = '2026-07-02T00:00:00.000Z';
  const job = offenerJob({ status: 'gesendet', sentAt: '2026-07-01T00:00:00.000Z', replyReceivedAt: echteAntwort });
  await storage.save(job);

  const reply: InboxReply = { from: 'office@acme.at', subject: 'Re: Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-10') };
  const deps = fakeDeps({ fetchInboxReplies: async () => [reply] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.replyGefuellt, 0);
  const updated = await storage.get(job.id);
  assert.equal(updated?.replyReceivedAt, echteAntwort);
});

test('frisch gesetztes sentAt zaehlt sofort fuer die Antwort-Zuordnung im selben Lauf', async (t) => {
  // Regressionstest fuer die "Liste neu laden statt weiterreichen"-Reihenfolge:
  // ein Job ohne sentAt, der im selben Sync per Sent-Scan ein sentAt bekommt, muss
  // trotzdem noch im selben Lauf eine Antwort zugeordnet bekommen koennen.
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ status: 'gesendet', sentAt: null, replyReceivedAt: null });
  await storage.save(job);

  const reply: InboxReply = { from: 'office@acme.at', subject: 'Re: Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-10') };
  const deps = fakeDeps({
    fetchSentMails: async () => [sentMail()],
    fetchInboxReplies: async () => [reply],
  });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.sentGefuellt, 1);
  assert.equal(result.replyGefuellt, 1);
  const updated = await storage.get(job.id);
  assert.ok(updated?.sentAt);
  assert.ok(updated?.replyReceivedAt);
});

test('leeres Postfach: keine Kandidaten, kein Fehler, alle Zaehler bei 0', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);

  const deps = fakeDeps();
  const result = await runGmailSync(storage, deps);

  assert.deepEqual(result, {
    sentGescannt: 0, postausgangGesendet: 0, markiert: 0, sentGefuellt: 0, ohneJob: 0,
    replyGescannt: 0, replyGefuellt: 0, absagen: 0, artGesetzt: 0, ohneArt: 0, seit: '2026-07-01',
  });
});

// ── replyScanSince + fetchAndFillReplies (Reply-Abruf, vorher inline im Handler) ──

test('replyScanSince: früheste gesendete Bewerbung, sentAt vor updatedAt', () => {
  const a = offenerJob({ status: 'gesendet', sentAt: '2026-07-05T00:00:00.000Z' });
  const b = offenerJob({ status: 'gesendet', sentAt: '2026-07-02T00:00:00.000Z' });
  const since = replyScanSince([a, b]);
  assert.equal(since?.toISOString(), '2026-07-02T00:00:00.000Z');
});

test('replyScanSince: kein gesendeter Job → null', () => {
  const neu = offenerJob({ status: 'new', sentAt: null });
  assert.equal(replyScanSince([neu]), null);
});

test('replyScanSince: Job mit sentAt zählt auch ohne Status "gesendet"', () => {
  const job = offenerJob({ status: 'triaged', sentAt: '2026-07-04T00:00:00.000Z' });
  const since = replyScanSince([job]);
  assert.equal(since?.toISOString(), '2026-07-04T00:00:00.000Z');
});

test('fetchAndFillReplies: ohne gesendete Jobs → 0/0, kein Fetch', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  await storage.save(offenerJob({ status: 'new', sentAt: null }));

  let fetched = false;
  const result = await fetchAndFillReplies(storage, { fetchInboxReplies: async () => { fetched = true; return []; }, classifyReply: regexReplyClassifier });

  assert.deepEqual(result, { checked: 0, matched: 0, absagen: 0, artGesetzt: 0, ohneArt: 0, ambiguous: [] });
  assert.equal(fetched, false);
});

test('fetchAndFillReplies: setzt replyReceivedAt für Lücke', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ status: 'gesendet', sentAt: '2026-07-01T00:00:00.000Z', replyReceivedAt: null });
  await storage.save(job);

  const reply: InboxReply = { from: 'office@acme.at', subject: 'Re: Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-10') };
  const result = await fetchAndFillReplies(storage, { fetchInboxReplies: async () => [reply], classifyReply: regexReplyClassifier });

  assert.deepEqual(result, { checked: 1, matched: 1, absagen: 0, artGesetzt: 1, ohneArt: 0, ambiguous: [] });
  assert.equal((await storage.get(job.id))?.replyReceivedAt, reply.date.toISOString());
});

test('fetchAndFillReplies: mehrdeutige Antwort → ambiguous mit Kandidaten, nichts gesetzt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const a = offenerJob({ title: 'Junior Developer', company: 'Acme', sentAt: '2026-07-01T00:00:00.000Z' });
  const b = { ...offenerJob({ title: 'Senior Developer', company: 'Acme', sentAt: '2026-07-01T00:00:00.000Z' }), status: 'gesendet' as const };
  await storage.save({ ...a, status: 'gesendet' as const });
  await storage.save(b);

  const reply: InboxReply = { from: 'office@acme.at', subject: 'Ihre Bewerbung', date: new Date('2026-07-10') };
  const result = await fetchAndFillReplies(storage, { fetchInboxReplies: async () => [reply], classifyReply: regexReplyClassifier });

  assert.equal(result.matched, 0);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(result.ambiguous[0].reply.from, 'office@acme.at');
  assert.equal(result.ambiguous[0].candidates.length, 2);
  assert.deepEqual(new Set(result.ambiguous[0].candidates.map(c => c.company)), new Set(['Acme']));
});

test('fetchAndFillReplies: überschreibt vorhandenes replyReceivedAt NICHT (der Fix)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const echt = '2026-07-02T00:00:00.000Z';
  const job = offenerJob({ status: 'gesendet', sentAt: '2026-07-01T00:00:00.000Z', replyReceivedAt: echt });
  await storage.save(job);

  const reply: InboxReply = { from: 'office@acme.at', subject: 'Re: Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-10') };
  const result = await fetchAndFillReplies(storage, { fetchInboxReplies: async () => [reply], classifyReply: regexReplyClassifier });

  assert.equal(result.matched, 0, 'nichts neu gesetzt');
  assert.equal((await storage.get(job.id))?.replyReceivedAt, echt, 'echter Wert unangetastet');
});

test('Postausgang: in Gmail abgeschickter Entwurf (ohne Label) → status gesendet + sentAt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = { ...offenerJob({ status: 'postausgang' }), scrapedAt: '2026-07-01T00:00:00.000Z' };
  const nichtGesendet = { ...offenerJob({ status: 'postausgang', title: 'Backend Dev', company: 'Beta', email: 'jobs@beta.at' }), scrapedAt: '2026-07-01T00:00:00.000Z' };
  await storage.save(job);
  await storage.save(nichtGesendet);

  const result = await runGmailSync(storage, fakeDeps({ fetchSentMails: async () => [sentMail({ labels: [] })] }));

  assert.equal(result.postausgangGesendet, 1);
  const updated = await storage.get(job.id);
  assert.equal(updated?.status, 'gesendet');
  assert.equal(updated?.sentAt, new Date('2026-07-05').toISOString());
  assert.equal((await storage.get(nichtGesendet.id))?.status, 'postausgang');
  // Die Mail gehört jetzt zum Job, nicht in die job-losen Kalender-Ereignisse.
  assert.equal(result.ohneJob, 0);
});

test('Postausgang: Mail vor dem Einlesen des Inserats zählt nicht (alte Bewerbung an dieselbe Adresse)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = { ...offenerJob({ status: 'postausgang' }), scrapedAt: '2026-08-01T00:00:00.000Z' };
  await storage.save(job);

  const result = await runGmailSync(storage, fakeDeps({ fetchSentMails: async () => [sentMail({ subject: 'Hallo', labels: [] })] }));

  assert.equal(result.postausgangGesendet, 0);
  assert.equal((await storage.get(job.id))?.status, 'postausgang');
});

test('Status anderer Jobs bleibt: gelabelte Mail zu einem "generated"-Job setzt nur sentAt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ status: 'generated' });
  await storage.save(job);

  await runGmailSync(storage, fakeDeps({ fetchSentMails: async () => [sentMail()] }));

  const updated = await storage.get(job.id);
  assert.equal(updated?.status, 'generated');
  assert.ok(updated?.sentAt);
});

test('Antwort-Art: Text der zugeordneten Antwort wird gelesen, Absage markiert, Eingang davor überschrieben', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ sentAt: '2026-07-05T00:00:00.000Z' });
  const fremd = offenerJob({ title: 'Andere Stelle', company: 'Gamma', email: 'hr@gamma.at', sentAt: '2026-07-05T00:00:00.000Z' });
  await storage.save(job);
  await storage.save(fremd);

  const replies: InboxReply[] = [
    { from: 'hr@acme.at', subject: 'Eingangsbestätigung', date: new Date('2026-07-06'), uid: 11 },
    { from: 'hr@acme.at', subject: 'Ihre Bewerbung', date: new Date('2026-07-20'), uid: 12 },
    { from: 'news@shop.at', subject: 'Newsletter', date: new Date('2026-07-07'), uid: 13 },
  ];
  const geholt: number[][] = [];
  const texte = new Map([
    [11, { text: 'Ihre Bewerbung ist bei uns eingegangen.', html: false }],
    [12, { text: '<p>Wir haben uns leider f&uuml;r einen anderen Kandidaten entschieden.</p>', html: true }],
  ]);

  const result = await runGmailSync(storage, fakeDeps({
    fetchInboxReplies: async () => replies,
    fetchReplyTexts: async uids => { geholt.push(uids); return texte; },
  }));

  assert.equal(result.absagen, 1);
  // Nur zugeordnete Antworten werden nachgeladen, kein Newsletter.
  assert.deepEqual(geholt, [[11, 12]]);
  const updated = await storage.get(job.id);
  assert.equal(updated?.replyKind, 'absage');
  assert.equal(updated?.status, 'gesendet');
  assert.equal((await storage.get(fremd.id))?.replyKind, undefined);

  // Zweiter Lauf: Job ist schon Absage → keine Texte mehr holen, nichts neu gezählt.
  const zweiter = await runGmailSync(storage, fakeDeps({
    fetchInboxReplies: async () => replies,
    fetchReplyTexts: async uids => { geholt.push(uids); return texte; },
  }));
  assert.equal(zweiter.absagen, 0);
  assert.deepEqual(geholt[1], []);
});

test('Antwort-Art: eigener Klassifizierer (JEV) wird benutzt, Zusage markiert', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ sentAt: '2026-07-05T00:00:00.000Z' });
  await storage.save(job);

  const replies: InboxReply[] = [{ from: 'hr@acme.at', subject: 'Einladung', date: new Date('2026-07-08'), uid: 21 }];
  const gefragt: string[] = [];
  await runGmailSync(storage, fakeDeps({
    fetchInboxReplies: async () => replies,
    fetchReplyTexts: async () => new Map([[21, { text: 'Wir laden Sie herzlich zum Gespräch ein.', html: false }]]),
    classifyReply: async (reply, text) => { gefragt.push(`${reply.subject}: ${text}`); return 'zusage'; },
  }));

  assert.deepEqual(gefragt, ['Einladung: Wir laden Sie herzlich zum Gespräch ein.']);
  assert.equal((await storage.get(job.id))?.replyKind, 'zusage');
});

test('Antwort-Art: ohne Urteil (JEV nicht erreichbar) bleibt die Art offen und zählt als ohneArt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ sentAt: '2026-07-05T00:00:00.000Z' });
  await storage.save(job);

  const result = await runGmailSync(storage, fakeDeps({
    fetchInboxReplies: async () => [{ from: 'hr@acme.at', subject: 'Ihre Bewerbung', date: new Date('2026-07-08'), uid: 31 }],
    fetchReplyTexts: async () => new Map([[31, { text: 'Leider haben wir uns für einen anderen Kandidaten entschieden.', html: false }]]),
    classifyReply: async () => null,
  }));

  assert.equal(result.ohneArt, 1);
  assert.equal(result.artGesetzt, 0);
  assert.equal((await storage.get(job.id))?.replyKind, undefined);
});

test('Mail zu einem Job, der sein sentAt schon hat, ist KEINE Mail ohne Job (kein doppeltes Ereignis)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  await storage.save(offenerJob({ sentAt: '2026-07-05T00:00:00.000Z' }));

  const deps = fakeDeps({ fetchSentMails: async () => [sentMail({ labels: [] }), sentMail({ subject: 'Bewerbung als X bei Y', to: ['office@acme.at'], labels: [] })] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.markiert, 2);
  assert.equal(result.ohneJob, 0);
  assert.deepEqual(deps.savedEvents, [[]]);
});

test('Mail nur an die eigene Adresse zählt nicht als Bewerbung', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);

  const deps = fakeDeps({
    ownAddress: 'ich@gmail.com',
    fetchSentMails: async () => [sentMail({ to: ['Ich@gmail.com'], labels: [] })],
  });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.markiert, 0);
  assert.deepEqual(deps.savedEvents, [[]]);
});
