import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nachweisZeilen, nachweisHtml } from '../lib/nachweis.ts';
import { toJob } from '../lib/normalize.ts';
import type { Job } from '../scrapers/interface.ts';

function job(o: Partial<Job>): Job {
  const j = toJob({ source: 'karriere.at', url: 'https://www.karriere.at/jobs/1', title: o.title ?? 'Junior Dev', company: o.company ?? 'Acme', location: 'Linz', description: 'x' });
  return { ...j, status: 'gesendet', email: 'hr@acme.at', ...o };
}

test('nachweisZeilen: gesendete Jobs + job-lose Mails, nach Datum, Antwort-Art lesbar', () => {
  const zeilen = nachweisZeilen([
    job({ company: 'Spät', sentAt: '2026-09-02T10:00:00Z', replyReceivedAt: '2026-09-10T08:00:00Z', replyKind: 'absage' }),
    job({ company: 'Früh', sentAt: '2026-08-01T10:00:00Z' }),
    job({ company: 'Nie gesendet', status: 'postausgang' }),
    job({ company: 'Gelöscht, aber gesendet', status: 'geloescht', sentAt: '2026-08-15T10:00:00Z', replyReceivedAt: '2026-08-20T10:00:00Z' }),
    job({ company: 'Altbestand', sentAt: null }),
  ], [{ date: '2026-08-10T09:00:00Z', company: 'MailOnly', title: 'Dev', to: 'jobs@mailonly.at' }]);

  assert.deepEqual(zeilen.map(z => z.firma), ['Früh', 'MailOnly', 'Gelöscht, aber gesendet', 'Spät', 'Altbestand']);
  assert.equal(zeilen[3].antwort, 'Absage (10.09.2026)');
  assert.equal(zeilen[2].antwort, 'Antwort (20.08.2026)');
  assert.equal(zeilen[0].antwort, 'keine');
  assert.equal(zeilen[0].weg, 'E-Mail an hr@acme.at');
  assert.equal(zeilen[4].datum, null);
});

test('nachweisZeilen: Zeitraum inklusive, undatierte fallen raus', () => {
  const jobs = [
    job({ company: 'A', sentAt: '2026-08-01T23:00:00Z' }),
    job({ company: 'B', sentAt: '2026-08-31T10:00:00Z' }),
    job({ company: 'C', sentAt: '2026-09-01T10:00:00Z' }),
    job({ company: 'D', sentAt: null }),
  ];
  assert.deepEqual(nachweisZeilen(jobs, [], { von: '2026-08-01', bis: '2026-08-31' }).map(z => z.firma), ['A', 'B']);
});

test('nachweisHtml: escaped Inhalte, Kopf mit Zählung', () => {
  const zeilen = nachweisZeilen([job({ company: 'A&B <GmbH>', sentAt: '2026-08-01T10:00:00Z', replyKind: 'absage', replyReceivedAt: '2026-08-03T10:00:00Z' })], []);
  const html = nachweisHtml(zeilen, { name: 'Kevin Schaberl', zeitraum: {}, stand: new Date('2026-10-10') });
  assert.match(html, /A&amp;B &lt;GmbH&gt;/);
  assert.doesNotMatch(html, /<GmbH>/);
  assert.match(html, /1 Bewerbungen, davon 1 mit Antwort \(1 Absagen\)/);
  // Vom Portal schon kodiertes "&amp;" wird nicht doppelt kodiert.
  const doppelt = nachweisZeilen([job({ title: 'Cloud &amp; App Dev', sentAt: '2026-08-01T10:00:00Z' })], []);
  assert.equal(doppelt[0].stelle, 'Cloud & App Dev');
});
