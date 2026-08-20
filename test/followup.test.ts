import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLLOW_UP_DAYS,
  lastContactAt,
  daysSinceLastContact,
  isFollowUpCandidate,
  isFollowUpDue,
  dueFollowUps,
  recordFollowUp,
} from '../lib/followup.ts';
import { toJob } from '../lib/normalize.ts';
import type { Job } from '../scrapers/interface.ts';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const tageVorher = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const job = (overrides: Partial<Job> = {}): Job => ({
  ...toJob({
    source: 'karriere.at',
    url: 'https://www.karriere.at/jobs/123',
    title: 'Junior Developer',
    company: 'Test GmbH',
    description: 'Anforderungen: TypeScript.',
  }),
  status: 'gesendet',
  email: 'jobs@test.at',
  sentAt: tageVorher(5),
  ...overrides,
});

test('fällig, wenn seit dem Versand mindestens 3 Tage ohne Antwort vergangen sind', () => {
  assert.equal(isFollowUpDue(job({ sentAt: tageVorher(FOLLOW_UP_DAYS) }), NOW), true);
});

test('noch nicht fällig am Tag davor', () => {
  assert.equal(isFollowUpDue(job({ sentAt: tageVorher(FOLLOW_UP_DAYS - 1) }), NOW), false);
});

test('eine Antwort nimmt den Job dauerhaft raus', () => {
  assert.equal(isFollowUpDue(job({ sentAt: tageVorher(30), replyReceivedAt: tageVorher(29) }), NOW), false);
});

test('ohne E-Mail-Adresse kein Nachfass', () => {
  assert.equal(isFollowUpCandidate(job({ email: null })), false);
});

test('gelöschte Bewerbungen fassen nicht nach', () => {
  assert.equal(isFollowUpCandidate(job({ status: 'geloescht' })), false);
});

// Der rückwirkende Gmail-Sync (lib/mail-match.ts) setzt sentAt, ohne den Status zu
// ändern — nur auf status 'gesendet' zu prüfen liesse genau diese Altbestände durchfallen.
test('sentAt aus dem Sync reicht, auch ohne status "gesendet"', () => {
  assert.equal(isFollowUpCandidate(job({ status: 'freigegeben', sentAt: tageVorher(9) })), true);
});

test('nie gesendet ist nie fällig', () => {
  assert.equal(isFollowUpCandidate(job({ status: 'generated', sentAt: null })), false);
});

// Der Punkt an "alle 3 Tage bis Antwort": die Uhr läuft ab dem letzten Nachfass.
test('nach einem Nachfass läuft die Uhr neu ab diesem Nachfass', () => {
  const j = job({ sentAt: tageVorher(10), followUps: [{ at: tageVorher(1), via: 'sent' }] });
  assert.equal(lastContactAt(j), tageVorher(1));
  assert.equal(daysSinceLastContact(j, NOW), 1);
  assert.equal(isFollowUpDue(j, NOW), false);
});

test('drei Tage nach dem letzten Nachfass ist wieder fällig', () => {
  const j = job({ sentAt: tageVorher(10), followUps: [{ at: tageVorher(3), via: 'sent' }] });
  assert.equal(isFollowUpDue(j, NOW), true);
});

// Ein angelegter Entwurf zählt als erledigt — sonst bekäme derselbe Job beim
// nächsten Blick in den Tab einen zweiten Entwurf.
test('ein Entwurf stoppt die Uhr genauso wie ein Versand', () => {
  const j = job({ sentAt: tageVorher(10), followUps: [{ at: tageVorher(0), via: 'draft' }] });
  assert.equal(isFollowUpDue(j, NOW), false);
});

test('dueFollowUps sortiert die am längsten Wartenden nach oben', () => {
  const alt = job({ id: 'a', sentAt: tageVorher(20) });
  const neu = job({ id: 'b', sentAt: tageVorher(4) });
  const nichtFaellig = job({ id: 'c', sentAt: tageVorher(1) });
  assert.deepEqual(dueFollowUps([neu, nichtFaellig, alt], NOW).map(j => j.id), ['a', 'b']);
});

test('recordFollowUp hängt an, statt zu überschreiben', () => {
  const j = job({ followUps: [{ at: tageVorher(6), via: 'sent' }] });
  const next = recordFollowUp(j, 'draft', NOW);
  assert.equal(next.length, 2);
  assert.deepEqual(next[1], { at: NOW.toISOString(), via: 'draft' });
});
