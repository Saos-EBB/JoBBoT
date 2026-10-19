import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings } from '../lib/settings.ts';

test('loadSettings: liest config/settings.json, filterMode ist "regex" oder "nimble"', () => {
  const settings = loadSettings();
  assert.ok(settings.filterMode === 'regex' || settings.filterMode === 'nimble');
});

test('loadSettings: inference-Block ist vollständig (Defaults füllen Lücken)', () => {
  const { inference } = loadSettings();
  assert.equal(typeof inference.think, 'boolean');
  assert.equal(typeof inference.writerTemperature, 'number');
});
