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

test('company: legal-form suffix is stripped', () => {
  const base = jobId({ title: 'Dev', company: 'Rubig' });
  assert.equal(jobId({ title: 'Dev', company: 'Rubig GmbH' }), base);
  assert.equal(jobId({ title: 'Dev', company: 'Rubig GmbH & Co KG' }), base);
  assert.equal(jobId({ title: 'Dev', company: 'Rubig AG' }), base);
});

test('company: diacritics are stripped, so RÜBIG collapses onto Rubig', () => {
  assert.equal(
    jobId({ title: 'Dev', company: 'RÜBIG GmbH & Co KG' }),
    jobId({ title: 'Dev', company: 'Rubig' }),
  );
});

test('title: gender marker is stripped regardless of order/punctuation', () => {
  const base = jobId({ title: 'Junior-Projektleiter Elektrotechnik', company: 'ACME' });
  assert.equal(jobId({ title: 'Junior-Projektleiter Elektrotechnik (m/w/d)', company: 'ACME' }), base);
  assert.equal(jobId({ title: 'Junior-Projektleiter Elektrotechnik (w/m/d)', company: 'ACME' }), base);
  assert.equal(jobId({ title: 'Junior-Projektleiter Elektrotechnik m-w-d', company: 'ACME' }), base);
  assert.equal(jobId({ title: 'Junior-Projektleiter Elektrotechnik (m/w/x)', company: 'ACME' }), base);
});

test('title: real near-duplicate pair collapses onto the same id (JKU frontend job)', () => {
  const company = 'Johannes Kepler Universität';
  assert.equal(
    jobId({ title: 'Frontend Developer (Senior) (m/w/d) (unbefristete Einstellung)', company }),
    jobId({ title: 'Frontend Developer (Senior) (w/m/d) (unbefristete Einstellung)', company }),
  );
});

test('empty company is still distinct from a filled-in one — not a fixable case here', () => {
  assert.notEqual(
    jobId({ title: 'Junior-Projektleiter Elektrotechnik (m/w/d)', company: '' }),
    jobId({ title: 'Junior-Projektleiter Elektrotechnik (m/w/d)', company: 'ETZI-Group GmbH' }),
  );
});
