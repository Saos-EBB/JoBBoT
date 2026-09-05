import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.ts';
import { trockenTransport } from '../mail/transport.ts';
import type { ComposedEmail } from '../mail/transport.ts';
import { gmailTransport } from '../mail/gmail.ts';
import { standardTransport } from '../lib/versand.ts';

// Ersetzt test/gmail.test.ts: dort wurde geprüft, dass createDraft/sendMail unter
// MAIL_DRY_RUN ohne Zugangsdaten und ohne Netz durchlaufen. Genau das ist jetzt ein
// eigener Adapter statt einer Verzweigung im Transport — und damit direkt prüfbar.

const email: ComposedEmail = { to: 'test@example.com', subject: 'Bewerbung als Dev bei X', text: 'Text' };

function mitLog<T>(fn: () => Promise<T>): Promise<string[]> {
  const zeilen: string[] = [];
  const echt = console.log;
  console.log = (...args: unknown[]) => { zeilen.push(args.join(' ')); };
  return fn().then(() => { console.log = echt; return zeilen; }, err => { console.log = echt; throw err; });
}

test('trockenTransport stellt nichts zu und braucht weder Zugangsdaten noch Netz', async () => {
  const prev = { user: config.gmailUser, pass: config.gmailAppPassword };
  config.gmailUser = undefined;
  config.gmailAppPassword = undefined;
  try {
    const zeilen = await mitLog(async () => {
      await trockenTransport.entwurf(email);
      await trockenTransport.sende(email);
    });
    assert.equal(zeilen.length, 2);
    assert.match(zeilen[0], /^\[MAIL_DRY_RUN\] draft → test@example\.com — Bewerbung als Dev bei X$/);
    assert.match(zeilen[1], /^\[MAIL_DRY_RUN\] send → test@example\.com — Bewerbung als Dev bei X$/);
  } finally {
    config.gmailUser = prev.user;
    config.gmailAppPassword = prev.pass;
  }
});

test('trockenTransport nennt Anhang und CC — sonst sieht ein Trockenlauf anders aus als der echte', async () => {
  const zeilen = await mitLog(() => trockenTransport.sende({
    ...email,
    cc: 'kopie@example.com',
    attachments: [{ filename: 'Lebenslauf.pdf', path: 'data/attachments/lebenslauf.pdf' }],
  }));
  assert.match(zeilen[0], /\(Anhang: Lebenslauf\.pdf\)/);
  assert.match(zeilen[0], /\(CC: kopie@example\.com\)/);
});

test('beide Adapter erfüllen dasselbe Interface', () => {
  for (const t of [trockenTransport, gmailTransport]) {
    assert.equal(typeof t.name, 'string');
    assert.equal(typeof t.entwurf, 'function');
    assert.equal(typeof t.sende, 'function');
  }
  assert.notEqual(trockenTransport.name, gmailTransport.name);
});

// Die Auswahl war vorher ein `if (config.mailDryRun)` INNERHALB von createDraft und
// sendMail — zweimal dieselbe Entscheidung, mitten im Transport. Jetzt eine Stelle.
test('standardTransport wählt nach MAIL_DRY_RUN aus', () => {
  const prev = config.mailDryRun;
  try {
    config.mailDryRun = true;
    assert.equal(standardTransport().name, 'trocken');
    config.mailDryRun = false;
    assert.equal(standardTransport().name, 'gmail');
  } finally {
    config.mailDryRun = prev;
  }
});
