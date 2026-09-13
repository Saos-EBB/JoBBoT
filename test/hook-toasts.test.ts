import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useToasts } from '../ui/hooks/toasts.ts';
import { renderHook, act, flushAsync } from './render-hook.ts';

// say() schedules a real setTimeout that outlives the test if left untouched — mock
// timers in every test (even the ones not asserting on expiry) so nothing fires for
// real after the test function returns.

test('initial: kein Toast', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { result, unmount } = renderHook(() => useToasts(), undefined);
  assert.equal(result.current.toast, null);
  unmount();
});

test('say setzt den Toast, Standardart ist "ok"', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { result, unmount } = renderHook(() => useToasts(), undefined);
  act(() => { result.current.say('Gespeichert'); });
  assert.deepEqual(result.current.toast, { msg: 'Gespeichert', kind: 'ok' });
  unmount();
});

test('say mit kind "err"', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { result, unmount } = renderHook(() => useToasts(), undefined);
  act(() => { result.current.say('Kaputt', 'err'); });
  assert.deepEqual(result.current.toast, { msg: 'Kaputt', kind: 'err' });
  unmount();
});

test('Toast verschwindet nach 1900ms von selbst', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { result, unmount } = renderHook(() => useToasts(), undefined);

  act(() => { result.current.say('kurz'); });
  assert.notEqual(result.current.toast, null);

  await act(async () => { t.mock.timers.tick(1900); await flushAsync(); });
  assert.equal(result.current.toast, null);
  unmount();
});

test('vor Ablauf der 1900ms bleibt der Toast stehen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { result, unmount } = renderHook(() => useToasts(), undefined);

  act(() => { result.current.say('kurz'); });
  await act(async () => { t.mock.timers.tick(1000); await flushAsync(); });
  assert.deepEqual(result.current.toast, { msg: 'kurz', kind: 'ok' });
  unmount();
});
