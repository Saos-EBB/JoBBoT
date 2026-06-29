import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../lib/slugify.ts';

test('slugify: basic', () => assert.equal(slugify('Junior Developer'), 'junior-developer'));
test('slugify: special chars', () => assert.equal(slugify('Acme GmbH & Co. KG'), 'acme-gmbh-co-kg'));
test('slugify: umlauts', () => assert.equal(slugify('Über Äpfel & Öl'), 'ueber-aepfel-oel'));
test('slugify: max 40 chars', () => assert.ok(slugify('a'.repeat(60)).length <= 40));
test('slugify: strips leading/trailing dashes', () => assert.equal(slugify('---test---'), 'test'));
test('slugify: empty string', () => assert.equal(slugify(''), ''));
