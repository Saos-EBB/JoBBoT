import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQuery, describeProblem, usableQueries } from '../lib/query-schema.ts';
import { karriereAtAdapter } from '../scrapers/karriere-at.ts';
import { amsAdapter } from '../scrapers/ams.ts';
import { devJobsAtAdapter } from '../scrapers/devjobs-at.ts';
import type { QueryField } from '../scrapers/interface.ts';

const schema: QueryField[] = [
  { key: 'keyword', label: 'Suchbegriff', required: true, format: 'text' },
  { key: 'location', label: 'Suchgebiet', required: false, format: 'text' },
];

test('gültige Anfrage: keine Beanstandung', () => {
  assert.deepEqual(checkQuery(schema, { keyword: 'junior developer' }), []);
});

test('optionales Feld darf fehlen', () => {
  assert.deepEqual(checkQuery(schema, { keyword: 'x', location: 'Linz' }), []);
});

test('fehlendes Pflichtfeld wird gemeldet', () => {
  assert.deepEqual(checkQuery(schema, { location: 'Linz' }), [{ kind: 'missing', key: 'keyword' }]);
});

test('leeres Pflichtfeld zählt als fehlend', () => {
  assert.deepEqual(checkQuery(schema, { keyword: '   ' }), [{ kind: 'missing', key: 'keyword' }]);
});

// Der Fall, um den es eigentlich geht: ein Tippfehler im SCHLÜSSEL. Vorher hat jeder
// Adapter die Anfrage kommentarlos übersprungen (`if (!keyword) continue`).
test('unbekannter Schlüssel wird gemeldet, nicht verschluckt', () => {
  const probleme = checkQuery(schema, { keywords: 'junior developer' });
  assert.equal(probleme.length, 2); // "keyword" fehlt UND "keywords" ist unbekannt
  assert.ok(probleme.some(p => p.kind === 'unknown' && p.key === 'keywords'));
});

test('describeProblem nennt die erwarteten Schlüssel', () => {
  const [, unbekannt] = checkQuery(schema, { keywords: 'x' });
  assert.match(describeProblem(unbekannt), /keywords.*erwartet.*keyword, location/);
});

test('usableQueries lässt Gute durch, meldet Schlechte und bricht nicht ab', () => {
  const meldungen: string[] = [];
  const ok = usableQueries(
    { name: 'test', querySchema: schema },
    [{ keyword: 'a' }, { keywords: 'b' }, { keyword: 'c' }],
    m => meldungen.push(m),
  );
  assert.deepEqual(ok, [{ keyword: 'a' }, { keyword: 'c' }]);
  assert.equal(meldungen.length, 1);
  assert.match(meldungen[0], /\[test\] Anfrage 2 übersprungen/);
});

// Die echten Schemata: das Formular der Einstellungsseite wird daraus gebaut, ein
// vertippter Schlüssel hier fällt sonst erst im Browser auf.
test('karriere.at verlangt genau ein Pflichtfeld im Slug-Format', () => {
  assert.deepEqual(karriereAtAdapter.querySchema.map(f => [f.key, f.format, f.required]),
    [['keyword', 'slug', true]]);
});

test('ams hat drei Felder, nur der Begriff ist Pflicht', () => {
  assert.deepEqual(amsAdapter.querySchema.map(f => f.key), ['keyword', 'location', 'vicinity']);
  assert.deepEqual(amsAdapter.querySchema.filter(f => f.required).map(f => f.key), ['keyword']);
});

// devjobs.at ist das einzige Portal ohne Suchbegriff — das Formular muss damit umgehen.
test('devjobs.at hat kein keyword, sondern params', () => {
  assert.deepEqual(devJobsAtAdapter.querySchema.map(f => [f.key, f.format]), [['params', 'raw']]);
});

test('die echte config/sources.json erfüllt alle Schemata', async () => {
  const { loadSources } = await import('../lib/sources.ts');
  const { buildScrapeSetup } = await import('../lib/scrape-setup.ts');
  const { registry } = buildScrapeSetup();
  const sources = loadSources();
  for (const [name, cfg] of Object.entries(sources)) {
    const adapter = registry[name];
    assert.ok(adapter, `config/sources.json nennt "${name}", wofür es keinen Adapter gibt`);
    for (const [i, q] of cfg.queries.entries()) {
      assert.deepEqual(checkQuery(adapter.querySchema, q), [],
        `${name} Anfrage ${i + 1}: ${checkQuery(adapter.querySchema, q).map(describeProblem).join('; ')}`);
    }
  }
});
