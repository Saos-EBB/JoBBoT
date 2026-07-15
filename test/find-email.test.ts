import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromDescription, isMatch, normalize } from '../lib/find-email.ts';

test('extractFromDescription: plain email', () =>
  assert.equal(extractFromDescription('Bewerbung an office@firma.at senden'), 'office@firma.at'));
test('extractFromDescription: (at)/(dot) obfuscation', () =>
  assert.equal(extractFromDescription('Kontakt: office (at) firma (dot) at'), 'office@firma.at'));
test('extractFromDescription: [at] obfuscation', () =>
  assert.equal(extractFromDescription('office[at]firma.at'), 'office@firma.at'));
test('extractFromDescription: no email present', () =>
  assert.equal(extractFromDescription('Bewerben Sie sich über unser Formular.'), null));

test('normalize: strips legal form suffixes', () => assert.equal(normalize('CELUM GmbH'), 'celum'));
test('normalize: Ges.m.b.H. variants', () => assert.equal(normalize('E+E Elektronik Ges.m.b.H.'), 'eeelektronik'));
test('normalize: lowercases and strips punctuation', () => assert.equal(normalize('VectaCore Engineering GmbH'), 'vectacore'));

// Regressionstest für den real beobachteten Fehlversand-Fall: "E + E Elektronik" durfte
// NICHT auf "Handshake Handels GesmbH" matchen (siehe findings/HANDOFF-gmail-versand.md)
test('isMatch: rejects unrelated company (E+E / Handshake false-positive case)', () =>
  assert.equal(isMatch('E + E Elektronik Ges.m.b.H.', 'Handshake Handels GesmbH'), false));

test('isMatch: exact name match', () =>
  assert.equal(isMatch('Dynatrace Austria GmbH', 'Dynatrace Austria GmbH'), true));
test('isMatch: candidate has fuller legal name', () =>
  assert.equal(isMatch('VectaCore', 'VectaCore Engineering GmbH'), true));
test('isMatch: candidate has holding-company suffix', () =>
  assert.equal(isMatch('Wacker Neuson', 'Wacker Neuson Beteiligungs GmbH'), true));
test('isMatch: completely different companies', () =>
  assert.equal(isMatch('BMW Group', 'CELUM GmbH'), false));
