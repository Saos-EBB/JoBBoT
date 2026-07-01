import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, extractRequirements, buildStageInput } from '../lib/job-text.ts';
import { toJob } from '../lib/normalize.ts';

test('stripHtml: entfernt Tags, dekodiert Entities, kollabiert Whitespace', () => {
  assert.equal(stripHtml('<p>Hallo &amp; <b>Welt</b></p>'), 'Hallo & Welt');
});

test('extractRequirements: findet Überschrift und schneidet dort ab', () => {
  const text = 'Über uns: wir sind toll. '.repeat(20) + 'Anforderungen: Java, TypeScript, Teamgeist.';
  const result = extractRequirements(text);
  assert.ok(result.startsWith('Anforderungen:'));
});

test('extractRequirements: keine Überschrift → erste 800 Zeichen', () => {
  const text = 'x'.repeat(1000);
  const result = extractRequirements(text);
  assert.equal(result, 'x'.repeat(800));
});

test('buildStageInput: enthält title + "Anforderungen", nicht postedAt/url', () => {
  const job = toJob({
    source: 'karriere.at',
    url: 'https://www.karriere.at/jobs/123',
    title: 'Junior Developer',
    company: 'Test GmbH',
    description: 'Anforderungen: Java-Kenntnisse.',
    postedAt: '2026-01-01T00:00:00Z',
  });
  const input = buildStageInput(job);
  assert.ok(input.includes(job.title));
  assert.ok(input.includes('Anforderungen'));
  assert.ok(!input.includes(job.postedAt as string));
  assert.ok(!input.includes(job.url));
});
