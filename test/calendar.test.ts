import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsDescending, HISTORY_START } from '../lib/calendar.ts';

test('monthsDescending: neuester Monat zuerst', () => {
  assert.deepEqual(monthsDescending('2026-07-01', '2026-09-30'), ['2026-09', '2026-08', '2026-07']);
});

test('monthsDescending: einzelner Monat', () => {
  assert.deepEqual(monthsDescending('2026-07-01', '2026-07-15'), ['2026-07']);
});

test('monthsDescending: füllt Lücken statt Monate zu überspringen', () => {
  const m = monthsDescending('2026-07-01', '2026-11-01');
  assert.equal(m.length, 5);
  assert.deepEqual(m, ['2026-11', '2026-10', '2026-09', '2026-08', '2026-07']);
});

test('monthsDescending: über den Jahreswechsel', () => {
  assert.deepEqual(monthsDescending('2026-11-01', '2027-02-01'), ['2027-02', '2027-01', '2026-12', '2026-11']);
});

test('monthsDescending: Ende vor Start ergibt leere Liste', () => {
  assert.deepEqual(monthsDescending('2026-09-01', '2026-07-01'), []);
});

test('HISTORY_START ist ein gültiges ISO-Datum', () => {
  assert.match(HISTORY_START, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Number.isNaN(new Date(HISTORY_START).getTime()), false);
});
