import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildReplyPrompt, createJevReplyClassifier, replyKey, stripQuoted } from '../lib/reply-kind-jev.ts';
import type { Ask } from '../lib/nimble-client.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const reply = { date: new Date('2026-07-08T10:00:00Z'), from: 'hr@acme.at', subject: 'Ihre Bewerbung' };

// Zählt nur echte Fragen (Prompt mit "Field:"), nicht das Priming.
function askWith(answers: string[]): { ask: Ask; calls: () => number } {
  let n = 0;
  const ask: Ask = async prompt => {
    if (!prompt.includes('Field: ')) return '';
    return answers[Math.min(n++, answers.length - 1)];
  };
  return { ask, calls: () => n };
}

test('stripQuoted: zitierte Bewerbung unter "Am … schrieb" / ">" fällt weg', () => {
  assert.equal(stripQuoted('Danke, wir melden uns.\n\nAm 01.07.2026 um 10:00 schrieb Kevin:\n> Sehr geehrte'), 'Danke, wir melden uns.');
  assert.equal(stripQuoted('Kurz:\nbitte hier zustimmen.\n> alt'), 'Kurz: bitte hier zustimmen.');
  assert.equal(stripQuoted('Ohne Zitat.'), 'Ohne Zitat.');
});

test('buildReplyPrompt: festes Schema vorne, Betreff + Text, Feld am Ende', () => {
  const p = buildReplyPrompt('Einladung', 'Wir laden Sie ein.');
  assert.ok(p.startsWith('Schema:\n'));
  assert.ok(p.includes('"datenschutz"') && p.includes('"plattform"'));
  assert.ok(p.endsWith('Context:\nBetreff: Einladung\nWir laden Sie ein.\n\nField: antwort_art'));
});

test('Klassifizierer: Buchstabe → Art, Urteil landet im Cache, zweiter Aufruf fragt nicht mehr', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const cachePath = join(dir, 'reply-kinds.json');
  const { ask, calls } = askWith(['C']);
  const classify = createJevReplyClassifier({ ask, cachePath, ensureReady: async () => {} });

  assert.equal(await classify(reply, 'Bitte stimmen Sie unserer Datenschutzerklärung zu.'), 'datenschutz');
  assert.equal(await classify(reply, 'egal'), 'datenschutz');
  assert.equal(calls(), 1);
  assert.deepEqual(JSON.parse(await readFile(cachePath, 'utf8')), { [replyKey(reply)]: 'datenschutz' });
});

test('Klassifizierer: Server nicht erreichbar → kein Urteil (null), kein Modell-Aufruf', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const { ask, calls } = askWith(['B']);
  const classify = createJevReplyClassifier({ ask, cachePath: join(dir, 'c.json'), ensureReady: async () => { throw new Error('down'); } });

  assert.equal(await classify(reply, 'Wir haben uns für einen anderen Kandidaten entschieden.'), null);
  assert.equal(calls(), 0);
});

test('Klassifizierer: unbrauchbare Antwort → null, NICHT gecacht (nächster Sync versucht es neu)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const cachePath = join(dir, 'c.json');
  const classify = createJevReplyClassifier({ ask: askWith(['?']).ask, cachePath, ensureReady: async () => {} });

  assert.equal(await classify(reply, 'Ihre Bewerbung ist bei uns eingegangen.'), null);
  await assert.rejects(readFile(cachePath, 'utf8'));
});
