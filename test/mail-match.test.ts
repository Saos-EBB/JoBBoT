import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchReplies, matchSent } from '../lib/mail-match.ts';
import { toJob } from '../lib/normalize.ts';
import type { Job } from '../scrapers/interface.ts';
import type { InboxReply, SentMail } from '../mail/gmail.ts';

function gesendetJob(overrides: Partial<{ title: string; company: string; email: string; updatedAt: string }> = {}): Job {
  const job = toJob({
    source: 'karriere.at',
    url: 'https://www.karriere.at/jobs/123',
    title: overrides.title ?? 'Junior Developer',
    company: overrides.company ?? 'Acme',
    description: 'Anforderungen: TypeScript-Kenntnisse.',
  });
  return { ...job, status: 'gesendet', email: overrides.email ?? 'office@acme.at', updatedAt: overrides.updatedAt ?? '2026-07-01T00:00:00.000Z' };
}

function reply(overrides: Partial<InboxReply> = {}): InboxReply {
  return { from: 'office@acme.at', subject: 'Re: Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-05'), ...overrides };
}

test('matches a reply by domain + reconstructed subject', () => {
  const job = gesendetJob();
  const matches = matchReplies([reply()], [job]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].job.id, job.id);
});

test('does not match a reply from before the application was sent', () => {
  const job = gesendetJob({ updatedAt: '2026-07-10T00:00:00.000Z' });
  const matches = matchReplies([reply({ date: new Date('2026-07-05') })], [job]);
  assert.equal(matches.length, 0);
});

test('ignores jobs that are not status "gesendet"', () => {
  const job = { ...gesendetJob(), status: 'triaged' as const };
  const matches = matchReplies([reply()], [job]);
  assert.equal(matches.length, 0);
});

test('shared-inbox domain with two jobs: subject disambiguates', () => {
  const a = gesendetJob({ title: 'Junior Developer', company: 'Acme' });
  const b = gesendetJob({ title: 'Senior Developer', company: 'Acme' });
  const matches = matchReplies([reply({ subject: 'AW: Bewerbung als Senior Developer bei Acme' })], [a, b]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].job.id, b.id);
});

test('shared-inbox domain, ambiguous subject: skipped rather than guessed', () => {
  const a = gesendetJob({ title: 'Junior Developer', company: 'Acme' });
  const b = gesendetJob({ title: 'Senior Developer', company: 'Acme' });
  const matches = matchReplies([reply({ subject: 'Hallo, vielen Dank für Ihre Bewerbung' })], [a, b]);
  assert.equal(matches.length, 0);
});

test('no match when sender domain differs from job.email', () => {
  const job = gesendetJob({ email: 'office@acme.at' });
  const matches = matchReplies([reply({ from: 'office@other.at' })], [job]);
  assert.equal(matches.length, 0);
});

// --- Sent-Ordner-Scan (rückwirkendes sentAt) ---

function offenerJob(overrides: Partial<{ title: string; company: string; email: string; sentAt: string }> = {}): Job {
  const job = toJob({
    source: 'karriere.at',
    url: 'https://www.karriere.at/jobs/123',
    title: overrides.title ?? 'Junior Developer',
    company: overrides.company ?? 'Acme',
    description: 'Anforderungen: TypeScript-Kenntnisse.',
  });
  return { ...job, email: overrides.email ?? 'office@acme.at', sentAt: overrides.sentAt ?? null };
}

function sent(overrides: Partial<SentMail> = {}): SentMail {
  return { to: ['office@acme.at'], subject: 'Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-05'), labels: ['Bewerbung'], ...overrides };
}

test('matchSent: exakte Empfängeradresse trifft', () => {
  const job = offenerJob();
  const matches = matchSent([sent()], [job]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].job.id, job.id);
  assert.equal(matches[0].date.toISOString(), new Date('2026-07-05').toISOString());
});

test('matchSent: Jobs mit vorhandenem sentAt bleiben unangetastet', () => {
  const job = offenerJob({ sentAt: '2026-06-01T00:00:00.000Z' });
  assert.equal(matchSent([sent()], [job]).length, 0);
});

test('matchSent: fremde Adresse UND fremder Betreff trifft nicht', () => {
  const job = offenerJob({ email: 'office@acme.at' });
  const fremd = sent({ to: ['office@other.at'], subject: 'Bewerbung als Irgendwas bei Andere GmbH' });
  assert.equal(matchSent([fremd], [job]).length, 0);
});

test('matchSent: Betreff trifft auch ohne job.email', () => {
  // Der Fall aus dem Juli-Bestand: ein Re-Scrape hat das Job-JSON neu geschrieben und
  // dabei die Adresse verloren — der Betreff ist dann der einzige verbliebene Anker.
  const job = { ...offenerJob(), email: null };
  const matches = matchSent([sent({ to: ['irgendwer@acme.at'] })], [job]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].job.id, job.id);
});

test('matchSent: liefert die zugeordnete Mail mit', () => {
  const job = offenerJob();
  const mail = sent();
  assert.equal(matchSent([mail], [job])[0].mail, mail);
});

test('matchSent: älteste Mail gewinnt, Nachfassen zählt nicht', () => {
  const job = offenerJob();
  const matches = matchSent([
    sent({ date: new Date('2026-07-20') }),
    sent({ date: new Date('2026-07-05') }),
  ], [job]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].date.toISOString(), new Date('2026-07-05').toISOString());
});

test('matchSent: geteilte Firmenadresse wird über den Betreff getrennt', () => {
  const a = offenerJob({ title: 'Junior Developer', company: 'Acme' });
  const b = offenerJob({ title: 'Senior Developer', company: 'Acme' });
  const matches = matchSent([sent({ subject: 'Bewerbung als Senior Developer bei Acme' })], [a, b]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].job.id, b.id);
});

test('matchSent: geteilte Adresse ohne Betreff-Treffer wird übersprungen statt geraten', () => {
  const a = offenerJob({ title: 'Junior Developer', company: 'Acme' });
  const b = offenerJob({ title: 'Senior Developer', company: 'Acme' });
  assert.equal(matchSent([sent({ subject: 'Ihre Unterlagen' })], [a, b]).length, 0);
});

test('matchReplies: sentAt allein genügt, auch ohne Status "gesendet"', () => {
  const job = { ...offenerJob({ sentAt: '2026-07-01T00:00:00.000Z' }), status: 'triaged' as const };
  assert.equal(matchReplies([reply()], [job]).length, 1);
});
