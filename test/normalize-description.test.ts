import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDescription } from '../lib/normalize-description.ts';

test('normalizeDescription: h2/ul/li wird zu Markdown-artigem Fließtext, keine Tags übrig', () => {
  const input = '<h2>Titel</h2><ul><li>Erstens</li><li>Zweitens</li></ul>';
  const result = normalizeDescription(input);
  assert.equal(result, '## Titel\n\n- Erstens\n- Zweitens');
  assert.ok(!result.includes('<'));
});

test('normalizeDescription: doppelt-escaptes &amp;amp; wird nur EINMAL dekodiert', () => {
  assert.equal(normalizeDescription('Spring &amp;amp; Kotlin'), 'Spring &amp; Kotlin');
});

test('normalizeDescription: einfach-escaptes &amp; wird zu echtem &', () => {
  assert.equal(normalizeDescription('Spring &amp; Kotlin'), 'Spring & Kotlin');
});

test('normalizeDescription: abgeschnittenes "</ul" ohne ">" wird vollständig gestrippt', () => {
  const result = normalizeDescription('<ul><li>Punkt</li></ul');
  assert.equal(result, '- Punkt');
  assert.ok(!result.includes('<'));
});

test('normalizeDescription: leerer String bleibt leerer String', () => {
  assert.equal(normalizeDescription(''), '');
});

test('normalizeDescription: bereits sauberer Plaintext bleibt unverändert (idempotent)', () => {
  const plain = 'Backend Developer:in (all Levels)\n\nWir suchen dich für unser Team.';
  assert.equal(normalizeDescription(plain), plain);
});

test('normalizeDescription: 3+ Leerzeilen werden auf 2 kollabiert', () => {
  assert.equal(normalizeDescription('Erstens\n\n\n\n\nZweitens'), 'Erstens\n\nZweitens');
});

test('normalizeDescription: script/style samt Inhalt wird entfernt', () => {
  const input = '<div>Text<script>alert(1)</script><style>.x{color:red}</style><p>Mehr Text</p></div>';
  const result = normalizeDescription(input);
  assert.ok(!result.includes('alert'));
  assert.ok(!result.includes('color:red'));
  assert.equal(result, 'Text\nMehr Text');
});
