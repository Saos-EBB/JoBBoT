import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInRange, loadLocationConfig } from '../lib/location.ts';

const cfg = loadLocationConfig();

test('isInRange: Linz → true', () => assert.ok(isInRange('Linz', cfg)));
test('isInRange: Oberösterreich → true', () => assert.ok(isInRange('Oberösterreich', cfg)));
test('isInRange: Remote (case-insensitive) → true', () => assert.ok(isInRange('Remote', cfg)));
test('isInRange: Wien → false', () => assert.ok(!isInRange('Wien', cfg)));
test('isInRange: Graz → false', () => assert.ok(!isInRange('Graz', cfg)));
test('isInRange: "" → true', () => assert.ok(isInRange('', cfg)));
test('isInRange: "   " → true', () => assert.ok(isInRange('   ', cfg)));
test('isInRange: "Linz, Homeoffice möglich" → true', () => assert.ok(isInRange('Linz, Homeoffice möglich', cfg)));
