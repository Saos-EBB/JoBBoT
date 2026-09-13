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

test('loadSettings: inference-Block ist vollständig (Defaults füllen Lücken)', () => {
  const { inference } = loadSettings();
  assert.equal(typeof inference.think, 'boolean');
  assert.equal(typeof inference.numCtx, 'number');
  assert.equal(typeof inference.filterTemperature, 'number');
  assert.equal(typeof inference.writerTemperature, 'number');
});
