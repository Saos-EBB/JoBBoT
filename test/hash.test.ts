import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobId } from '../lib/hash.ts';

test('determinism: same input → same id', () => {
  const a = jobId({ title: 'Dev', company: 'ACME' });
  const b = jobId({ title: 'Dev', company: 'ACME' });
  assert.equal(a, b);
});

test('normalization: whitespace/case variants collapse to same id', () => {
  const base = jobId({ title: 'Junior Dev', company: 'ACME' });
  assert.equal(jobId({ title: ' junior   dev ', company: 'acme' }), base);
  assert.equal(jobId({ title: 'JUNIOR\tDEV', company: 'Acme' }), base);
  assert.equal(jobId({ title: 'junior\n dev', company: 'ACME' }), base);
});

test('different title → different id', () => {
  assert.notEqual(
    jobId({ title: 'Dev', company: 'ACME' }),
    jobId({ title: 'Senior Dev', company: 'ACME' }),
  );
});

test('different company → different id', () => {
  assert.notEqual(
    jobId({ title: 'Dev', company: 'ACME' }),
    jobId({ title: 'Dev', company: 'Initech' }),
  );
});

test('collision safety: pipe in title vs pipe in company', () => {
  const a = jobId({ title: 'a|b', company: 'c' });
  const b = jobId({ title: 'a', company: 'b|c' });
  assert.notEqual(a, b, 'naive "|" join would make these identical — must be distinct');
});

test('format: /^[0-9a-f]{16}$/ — empty strings', () => {
  assert.match(jobId({ title: '', company: '' }), /^[0-9a-f]{16}$/);
});

test('format: /^[0-9a-f]{16}$/ — very long strings', () => {
  assert.match(jobId({ title: 'x'.repeat(10_000), company: 'y'.repeat(10_000) }), /^[0-9a-f]{16}$/);
});

test('format: /^[0-9a-f]{16}$/ — unicode', () => {
  assert.match(jobId({ title: 'Softwareentwickler (ä/ö/ü)', company: '🚀 Startup GmbH' }), /^[0-9a-f]{16}$/);
});
