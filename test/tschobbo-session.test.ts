import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScrapeSession } from '../ui/tschobbo-session.js';

test('starts inactive, generation 0', () => {
  const session = createScrapeSession();
  assert.equal(session.active, false);
  assert.equal(session.generation, 0);
});

test('begin() activates and returns the new generation', () => {
  const session = createScrapeSession();
  const gen = session.begin();
  assert.equal(session.active, true);
  assert.equal(gen, 1);
  assert.equal(session.generation, 1);
});

test('isCurrent() reflects the generation captured at begin()', () => {
  const session = createScrapeSession();
  const gen = session.begin();
  assert.equal(session.isCurrent(gen), true);
  assert.equal(session.isCurrent(gen - 1), false);
});

test('a second begin() invalidates a generation captured before it', () => {
  const session = createScrapeSession();
  const first = session.begin();
  const second = session.begin();
  assert.notEqual(first, second);
  assert.equal(session.isCurrent(first), false);
  assert.equal(session.isCurrent(second), true);
});

test('finish() deactivates but keeps the generation — in-flight work from this session still counts as current', () => {
  const session = createScrapeSession();
  const gen = session.begin();
  session.finish();
  assert.equal(session.active, false);
  assert.equal(session.generation, gen);
  assert.equal(session.isCurrent(gen), true);
});

test('abort() deactivates and bumps the generation — in-flight work from this session no longer counts as current', () => {
  const session = createScrapeSession();
  const gen = session.begin();
  session.abort();
  assert.equal(session.active, false);
  assert.notEqual(session.generation, gen);
  assert.equal(session.isCurrent(gen), false);
});
