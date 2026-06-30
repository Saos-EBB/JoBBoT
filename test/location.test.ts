import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInRange, loadLocationConfig } from '../lib/location.ts';

const cfg = loadLocationConfig();

// bestehende Tests
test('isInRange: Linz → true', () => assert.ok(isInRange('Linz', cfg)));
test('isInRange: Oberösterreich → true', () => assert.ok(isInRange('Oberösterreich', cfg)));
test('isInRange: Remote (case-insensitive) → true', () => assert.ok(isInRange('Remote', cfg)));
test('isInRange: Wien → false', () => assert.ok(!isInRange('Wien', cfg)));
test('isInRange: Graz → false', () => assert.ok(!isInRange('Graz', cfg)));
test('isInRange: "" → true', () => assert.ok(isInRange('', cfg)));
test('isInRange: "   " → true', () => assert.ok(isInRange('   ', cfg)));
test('isInRange: "Linz, Homeoffice möglich" → true', () => assert.ok(isInRange('Linz, Homeoffice möglich', cfg)));

// COUNTRY_ONLY: exakter Match → true
test('isInRange: "Österreich" → true (COUNTRY_ONLY exact)', () => assert.ok(isInRange('Österreich', cfg)));
test('isInRange: "österreich" → true (COUNTRY_ONLY lowercase)', () => assert.ok(isInRange('österreich', cfg)));
test('isInRange: "Austria" → true (COUNTRY_ONLY)', () => assert.ok(isInRange('Austria', cfg)));

// COUNTRY_ONLY greift nur bei exakter Gleichheit, nicht als Substring
test('isInRange: "Österreich, Wien" → false (Wien konkret, kein Exakt-Match)', () => assert.ok(!isInRange('Österreich, Wien', cfg)));

// Linz-Match greift ohnehin über cities
test('isInRange: "Linz, Österreich" → true (Linz matcht)', () => assert.ok(isInRange('Linz, Österreich', cfg)));
