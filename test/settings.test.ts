import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings } from '../lib/settings.ts';

test('loadSettings: liest config/settings.json, filterMode ist "llm" oder "regex"', () => {
  const settings = loadSettings();
  assert.ok(settings.filterMode === 'llm' || settings.filterMode === 'regex');
});

test('loadSettings: filterModel ist gesetzt (aus Config oder Default)', () => {
  const settings = loadSettings();
  assert.equal(typeof settings.filterModel, 'string');
  assert.ok(settings.filterModel.length > 0);
});
