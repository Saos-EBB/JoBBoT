import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir, rmTmp } from './helpers.ts';
import { JsonStore } from '../storage/json-store.ts';
import { toJob } from '../lib/normalize.ts';
import { runGmailSync, type GmailSyncDeps } from '../lib/gmail-sync.ts';
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

test('unlabelte Mails zaehlen nicht als "markiert" und werden nicht zugeordnet', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = offenerJob({ sentAt: null });
  await storage.save(job);

  const deps = fakeDeps({ fetchSentMails: async () => [sentMail({ labels: [] })] });
  const result = await runGmailSync(storage, deps);

  assert.equal(result.sentGescannt, 1);
  assert.equal(result.markiert, 0);
  assert.equal(result.sentGefuellt, 0);
  const updated = await storage.get(job.id);
  assert.equal(updated?.sentAt, null);
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
    sentGescannt: 0, markiert: 0, sentGefuellt: 0, ohneJob: 0,
    replyGescannt: 0, replyGefuellt: 0, seit: '2026-07-01',
  });
});
