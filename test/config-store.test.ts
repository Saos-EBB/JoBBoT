import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSources, validateLocation } from '../lib/config-store.ts';

// Nur die Pruefung wird hier getestet, nicht das Schreiben: writeConfig() zielt fest auf
// config/ (Absicht — ein Pfad aus der Anfrage waere ein Ausbruch mit Ansage), und ein
// Test, der die echten Dateien anfasst, ist die Sorte Test, die einmal danebengeht und
// dann Kevins Suchbegriffe kostet. Der Schreibpfad ist derselbe wie in JsonStore
// (temp + rename), der dort seine eigenen Tests hat.

const gueltigeSources = {
  'karriere.at': { enabled: true, queries: [{ keyword: 'junior-entwickler' }] },
  'ams': { enabled: false, queries: [{ keyword: 'junior developer', location: 'Linz', vicinity: '40' }] },
};

test('gültige sources: keine Beanstandung', () => {
  assert.deepEqual(validateSources(gueltigeSources), []);
});

// Die Registry ist die Wahrheit — ein Portalname ohne Adapter darf nicht in die Datei.
test('unbekanntes Portal wird abgelehnt und nennt die bekannten', () => {
  const f = validateSources({ stepstone: { enabled: true, queries: [] } });
  assert.equal(f.length, 1);
  assert.match(f[0], /"stepstone" ist kein bekanntes Portal/);
  assert.match(f[0], /karriere\.at/);
});

test('Anfrage gegen das Schema des Portals geprüft', () => {
  const f = validateSources({ 'karriere.at': { enabled: true, queries: [{ keywords: 'tippfehler' }] } });
  assert.ok(f.some(x => /unbekannter Schlüssel "keywords"/.test(x)));
  assert.ok(f.some(x => /Pflichtfeld "keyword" fehlt/.test(x)));
});

test('devjobs.at braucht params, nicht keyword', () => {
  assert.ok(validateSources({ 'devjobs.at': { enabled: true, queries: [{ keyword: 'x' }] } }).length > 0);
  assert.deepEqual(validateSources({ 'devjobs.at': { enabled: true, queries: [{ params: 'jobLevel=junior-job-level' }] } }), []);
});

test('enabled muss boolean sein', () => {
  const f = validateSources({ 'karriere.at': { enabled: 'ja', queries: [] } });
  assert.ok(f.some(x => /enabled muss true oder false sein/.test(x)));
});

test('nicht-Text-Werte in einer Anfrage werden abgelehnt', () => {
  const f = validateSources({ 'ams': { enabled: true, queries: [{ keyword: 'x', vicinity: 40 }] } });
  assert.ok(f.some(x => /alle Werte müssen Text sein/.test(x)));
});

test('kein Objekt: eine verständliche Meldung statt eines Absturzes', () => {
  assert.equal(validateSources([]).length, 1);
  assert.equal(validateSources(null).length, 1);
  assert.equal(validateSources('nope').length, 1);
});

// ---- location ----

test('gültige location: keine Beanstandung', () => {
  assert.deepEqual(validateLocation({ cities: ['Linz'], regions: ['Oberösterreich'], remote: ['remote'] }), []);
});

test('fehlende Gruppe wird gemeldet', () => {
  const f = validateLocation({ cities: ['Linz'], regions: [] });
  assert.ok(f.some(x => /remote muss eine Liste aus Text sein/.test(x)));
});

test('Zahl in einer Ortsliste wird abgelehnt', () => {
  const f = validateLocation({ cities: [4040], regions: [], remote: [] });
  assert.ok(f.some(x => /cities muss eine Liste aus Text sein/.test(x)));
});

// Eine zusaetzliche Gruppe waere stiller Zustand: isInRange() liest nur die drei
// bekannten, alles andere haette keine Wirkung und niemand wuesste warum.
test('unbekannte Gruppe wird abgelehnt, nicht ignoriert', () => {
  const f = validateLocation({ cities: [], regions: [], remote: [], laender: ['Österreich'] });
  assert.ok(f.some(x => /Unbekannte Gruppe "laender"/.test(x)));
});

test('die echte config/location.json ist gültig', async () => {
  const { loadLocationConfig } = await import('../lib/location.ts');
  assert.deepEqual(validateLocation(loadLocationConfig()), []);
});

test('die echte config/sources.json ist gültig', async () => {
  const { loadSources } = await import('../lib/sources.ts');
  assert.deepEqual(validateSources(loadSources()), []);
});
