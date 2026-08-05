import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchReplies } from '../lib/mail-match.ts';
import { toJob } from '../lib/normalize.ts';
import type { Job } from '../scrapers/interface.ts';
import type { InboxReply } from '../mail/gmail.ts';

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
