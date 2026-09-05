import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpDir, rmTmp } from './helpers.ts';
import { loadSources } from '../lib/sources.ts';
import { loadLocationConfig } from '../lib/location.ts';
import { loadSettings } from '../lib/settings.ts';
import { loadProfile } from '../lib/profile.ts';
import { loadExperienceRules } from '../lib/experience-regex.ts';

// Der Grund für diese Datei: bis August 2026 lösten vier der fünf Config-Loader
// modul-relativ auf (new URL('../config/…', import.meta.url)) und lasen damit IMMER aus
// dem Repo — egal von wo der Prozess gestartet wurde. lib/profile.ts machte es als
// einziges cwd-relativ. Wer den Server aus einem anderen Verzeichnis startete, bekam
// fremde Config und eigene Daten, ohne dass irgendwo etwas fehlschlug.
//
// Der Test wechselt das Arbeitsverzeichnis und prüft, dass die Loader dorthin folgen.
// process.chdir() ist globaler Zustand — node --test führt jede Datei in einem eigenen
// Prozess aus, und t.after() stellt es zurück, damit die übrigen Tests dieser Datei
// nicht betroffen sind.
async function tempConfig(t: { after: (fn: () => void) => void }) {
  const dir = await tmpDir();
  const zurueck = process.cwd();
  t.after(() => { process.chdir(zurueck); rmTmp(dir); });
  await mkdir(join(dir, 'config'), { recursive: true });
  return { dir, schreibe: (name: string, data: unknown) =>
    writeFile(join(dir, 'config', name), JSON.stringify(data), 'utf8') };
}

test('loadSources liest aus dem Arbeitsverzeichnis, nicht aus dem Repo', async (t) => {
  const { dir, schreibe } = await tempConfig(t);
  await schreibe('sources.json', { 'karriere.at': { enabled: false, queries: [{ keyword: 'nur-hier' }] } });
  process.chdir(dir);
  assert.deepEqual(loadSources(), { 'karriere.at': { enabled: false, queries: [{ keyword: 'nur-hier' }] } });
});

test('loadLocationConfig folgt dem Arbeitsverzeichnis', async (t) => {
  const { dir, schreibe } = await tempConfig(t);
  await schreibe('location.json', { cities: ['Testhausen'], regions: [], remote: [] });
  process.chdir(dir);
  assert.deepEqual(loadLocationConfig().cities, ['Testhausen']);
});

test('loadSettings folgt dem Arbeitsverzeichnis', async (t) => {
  const { dir, schreibe } = await tempConfig(t);
  await schreibe('settings.json', { filterMode: 'llm', filterModel: 'testmodell' });
  process.chdir(dir);
  assert.equal(loadSettings().filterModel, 'testmodell');
});

// Die eine, die es schon immer richtig machte — mitgeprüft, damit die Reihe vollständig
// ist und niemand sie beim nächsten Umbau in die andere Richtung "vereinheitlicht".
// (Sie las den Pfad bis September 2026 als einzige fest verdrahtet statt über
// config.configDir — gleiches Ergebnis, solange configDir "config" ist, aber eben
// nur solange. Jetzt geht sie denselben Weg wie die anderen vier.)
test('loadProfile folgt dem Arbeitsverzeichnis', async (t) => {
  const { dir, schreibe } = await tempConfig(t);
  await schreibe('profile.json', { name: 'Test Person' });
  process.chdir(dir);
  assert.equal(loadProfile().name, 'Test Person');
});

// Die fünfte im Bunde, bisher hier nicht vertreten.
test('loadExperienceRules folgt dem Arbeitsverzeichnis', async (t) => {
  const { dir, schreibe } = await tempConfig(t);
  await schreibe('experience-rules.json', { minYears: 42, experienceWords: ['nur-hier'], disqualifyingPhrases: [], optionalMarkers: [], negationMarkers: [], juniorSignals: [], codingKeywords: [] });
  process.chdir(dir);
  assert.equal(loadExperienceRules().minYears, 42);
});

test('fehlende Datei im Arbeitsverzeichnis wird nicht still aus dem Repo ersetzt', async (t) => {
  const { dir } = await tempConfig(t);
  process.chdir(dir);
  assert.throws(() => loadSettings(), /settings\.json fehlt/);
});
