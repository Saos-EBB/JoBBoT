import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExperience, loadExperienceRules } from '../lib/experience-regex.ts';

const cfg = loadExperienceRules();

test('"Mind. 3 Jahre Berufserfahrung erforderlich" → disqualified', () => {
  const r = checkExperience('Mind. 3 Jahre Berufserfahrung erforderlich', cfg);
  assert.equal(r.disqualified, true);
});

test('"3 Jahre Erfahrung von Vorteil" → NICHT (optionalMarker)', () => {
  const r = checkExperience('3 Jahre Erfahrung von Vorteil', cfg);
  assert.equal(r.disqualified, false);
});

test('"Mehrjährige Erfahrung wünschenswert" → NICHT (optionalMarker)', () => {
  const r = checkExperience('Mehrjährige Erfahrung wünschenswert', cfg);
  assert.equal(r.disqualified, false);
});

test('"1-2 Jahre Erfahrung" → NICHT (< minYears)', () => {
  const r = checkExperience('1-2 Jahre Erfahrung', cfg);
  assert.equal(r.disqualified, false);
});

test('"3-5 Jahre Erfahrung vorausgesetzt" → disqualified (untere Zahl 3)', () => {
  const r = checkExperience('3-5 Jahre Erfahrung vorausgesetzt', cfg);
  assert.equal(r.disqualified, true);
});

test('"Keine Berufserfahrung nötig" → NICHT (negation)', () => {
  const r = checkExperience('Keine Berufserfahrung nötig', cfg);
  assert.equal(r.disqualified, false);
});

test('"Erste Erfahrung willkommen" → NICHT', () => {
  const r = checkExperience('Erste Erfahrung willkommen', cfg);
  assert.equal(r.disqualified, false);
});

test('"5+ years experience required" → disqualified', () => {
  const r = checkExperience('5+ years experience required', cfg);
  assert.equal(r.disqualified, true);
});

test('"Unternehmen seit 3 Jahren am Markt" → NICHT (kein experienceWord im Satz)', () => {
  const r = checkExperience('Unternehmen seit 3 Jahren am Markt', cfg);
  assert.equal(r.disqualified, false);
});

test('"Mehrjährige Berufserfahrung" (nackt) → disqualified', () => {
  const r = checkExperience('Mehrjährige Berufserfahrung', cfg);
  assert.equal(r.disqualified, true);
});

test('matched enthält den auslösenden Textausschnitt', () => {
  const r = checkExperience('Mind. 3 Jahre Berufserfahrung erforderlich', cfg);
  assert.ok(r.matched && r.matched.length > 0);
});

test('Aufzählung in einer Zeile: optionalMarker in einem anderen Punkt entschärft NICHT', () => {
  const r = checkExperience('Das bringen Sie mit - mehrjährige Berufserfahrung im IT-Support - Java idealerweise', cfg);
  assert.equal(r.disqualified, true);
});

test('Aufzählung in einer Zeile: optionalMarker im selben Punkt entschärft weiterhin', () => {
  const r = checkExperience('Profil - HTL-Abschluss - mehrjährige Erfahrung von Vorteil - Teamgeist', cfg);
  assert.equal(r.disqualified, false);
});

test('leerer Text → NICHT disqualified', () => {
  assert.equal(checkExperience('', cfg).disqualified, false);
});
