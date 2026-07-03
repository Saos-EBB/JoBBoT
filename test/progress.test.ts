import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgress, fitToWidth } from '../lib/progress.ts';

test('createProgress: returns object with all methods', () => {
  const p = createProgress('test');
  assert.strictEqual(typeof p.update, 'function');
  assert.strictEqual(typeof p.succeed, 'function');
  assert.strictEqual(typeof p.fail, 'function');
  assert.strictEqual(typeof p.stop, 'function');
  p.stop();
});

test('stop() then succeed() does not throw', () => {
  const p = createProgress();
  p.stop();
  assert.doesNotThrow(() => p.succeed('done'));
});

test('succeed() then fail() does not throw', () => {
  const p = createProgress();
  p.succeed('ok');
  assert.doesNotThrow(() => p.fail('err'));
});

test('stop() multiple times does not throw', () => {
  const p = createProgress();
  assert.doesNotThrow(() => { p.stop(); p.stop(); p.stop(); });
});

test('non-TTY: update + succeed + fail run without throw', () => {
  // node:test runs in non-TTY, so this covers the non-TTY branch
  const p = createProgress('initial');
  assert.doesNotThrow(() => {
    p.update('mid');
    p.succeed('done');
  });
  const p2 = createProgress();
  assert.doesNotThrow(() => {
    p2.update('x');
    p2.fail('boom');
  });
});

test('update() after stop() does not throw', () => {
  const p = createProgress('x');
  p.stop();
  assert.doesNotThrow(() => p.update('late update'));
});

test('fitToWidth: kürzt Zeilen, die die Terminalbreite erreichen oder überschreiten', () => {
  const cols = process.stdout.columns || 80;
  const short = 'x'.repeat(cols - 1);
  assert.equal(fitToWidth(short), short);

  const long = 'y'.repeat(cols + 20);
  const fitted = fitToWidth(long);
  assert.ok(fitted.length < cols, `sollte unter ${cols} Zeichen bleiben, war ${fitted.length}`);
  assert.ok(fitted.endsWith('…'));
});
