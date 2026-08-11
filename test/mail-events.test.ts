import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { istBewerbung, type SentMail } from '../mail/gmail.ts';
import { parseBewerbungsBetreff } from '../lib/mail-match.ts';
import { toMailEvents, loadMailEvents, saveMailEvents } from '../lib/mail-events.ts';
import { tmpDir, rmTmp } from './helpers.ts';

function mail(o: Partial<SentMail> = {}): SentMail {
  return { to: ['office@acme.at'], subject: 'Bewerbung als Junior Developer bei Acme', date: new Date('2026-07-05'), labels: ['Bewerbung'], ...o };
}

test('istBewerbung: erkennt beide Labels, Groß-/Kleinschreibung egal', () => {
  assert.equal(istBewerbung(mail({ labels: ['Bewerbung'] })), true);
  assert.equal(istBewerbung(mail({ labels: ['Beworben'] })), true);
  assert.equal(istBewerbung(mail({ labels: ['beworben'] })), true);
  assert.equal(istBewerbung(mail({ labels: ['\\Sent', 'Beworben'] })), true);
});

test('istBewerbung: ohne passendes Label falsch', () => {
  assert.equal(istBewerbung(mail({ labels: [] })), false);
  assert.equal(istBewerbung(mail({ labels: ['\\Sent', 'Rechnungen'] })), false);
});

test('parseBewerbungsBetreff: holt Titel und Firma zurück', () => {
  assert.deepEqual(parseBewerbungsBetreff('Bewerbung als Junior Developer bei Acme GmbH'), { title: 'Junior Developer', company: 'Acme GmbH' });
});

test('parseBewerbungsBetreff: fremder Betreff ergibt null', () => {
  assert.equal(parseBewerbungsBetreff('Hallo, anbei meine Unterlagen'), null);
});

test('toMailEvents: nutzt den Betreff für Titel und Firma', () => {
  const [ev] = toMailEvents([mail()]);
  assert.equal(ev.company, 'Acme');
  assert.equal(ev.title, 'Junior Developer');
  assert.equal(ev.date, new Date('2026-07-05').toISOString());
});

test('toMailEvents: fällt bei fremdem Betreff auf die Empfänger-Domain zurück', () => {
  const [ev] = toMailEvents([mail({ subject: 'Meine Unterlagen', to: ['jobs@ventopay.com'] })]);
  assert.equal(ev.company, 'ventopay.com');
  assert.equal(ev.title, 'Meine Unterlagen');
});

test('toMailEvents: chronologisch sortiert', () => {
  const evs = toMailEvents([mail({ date: new Date('2026-07-20') }), mail({ date: new Date('2026-07-05') })]);
  assert.deepEqual(evs.map(e => e.date.slice(0, 10)), ['2026-07-05', '2026-07-20']);
});

test('loadMailEvents: fehlende Datei ergibt leere Liste statt Fehler', async t => {
  const dir = await tmpDir(); t.after(() => rmTmp(dir));
  assert.deepEqual(await loadMailEvents(join(dir, 'gibtsnicht.json')), []);
});

test('saveMailEvents/loadMailEvents: Runde durch die Datei', async t => {
  const dir = await tmpDir(); t.after(() => rmTmp(dir));
  const pfad = join(dir, 'mail-events.json');
  const evs = toMailEvents([mail()]);
  await saveMailEvents(evs, pfad);
  assert.deepEqual(await loadMailEvents(pfad), evs);
});

test('saveMailEvents: überschreibt vollständig statt anzuhängen', async t => {
  const dir = await tmpDir(); t.after(() => rmTmp(dir));
  const pfad = join(dir, 'mail-events.json');
  await saveMailEvents(toMailEvents([mail(), mail({ date: new Date('2026-07-09') })]), pfad);
  await saveMailEvents(toMailEvents([mail()]), pfad);
  assert.equal((await loadMailEvents(pfad)).length, 1);
});
