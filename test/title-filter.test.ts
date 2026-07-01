import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTitle } from '../lib/title-filter.ts';

test('checkTitle: "Senior Fullstack Developer" → excluded, term "senior"', () => {
  const v = checkTitle('Senior Fullstack Developer');
  assert.strictEqual(v.excluded, true);
  assert.strictEqual(v.term, 'senior');
});

test('checkTitle: "Junior Java Entwickler & Project Lead" → excluded, term "lead"', () => {
  const v = checkTitle('Junior Java Entwickler & Project Lead');
  assert.strictEqual(v.excluded, true);
  assert.strictEqual(v.term, 'lead');
});

test('checkTitle: "Web-Developer:in & Softwarearchitekt:in" → excluded, term "architekt"', () => {
  const v = checkTitle('Web-Developer:in & Softwarearchitekt:in');
  assert.strictEqual(v.excluded, true);
  assert.strictEqual(v.term, 'architekt');
});

test('checkTitle: "Lehre Applikationsentwickler - Coding" → NICHT excluded (LLM sortiert)', () => {
  assert.strictEqual(checkTitle('Lehre Applikationsentwickler - Coding').excluded, false);
});

test('checkTitle: "Lehrling IT-Systemtechnik" → NICHT excluded (LLM sortiert)', () => {
  assert.strictEqual(checkTitle('Lehrling IT-Systemtechnik').excluded, false);
});

test('checkTitle: "Junior Software Developer" → NICHT excluded', () => {
  assert.strictEqual(checkTitle('Junior Software Developer').excluded, false);
});

test('checkTitle: "Software Engineer - Early Career" → NICHT excluded', () => {
  assert.strictEqual(checkTitle('Software Engineer - Early Career').excluded, false);
});

test('checkTitle: "Praktikum Junior App Manager" → NICHT excluded (Praktikum erlaubt)', () => {
  assert.strictEqual(checkTitle('Praktikum Junior App Manager').excluded, false);
});

test('checkTitle: "Junior Javascript & Typescript Backend Engineer" → NICHT excluded', () => {
  assert.strictEqual(checkTitle('Junior Javascript & Typescript Backend Engineer').excluded, false);
});
