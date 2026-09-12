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
// Jeder Loader nimmt seither einen optionalen configDir-Parameter (Default:
// config.configDir) — der Test übergibt den tmp-Pfad direkt, statt den Prozess mit
// process.chdir() umzuschalten. Kein globaler Zustand mehr, den t.after() zurückdrehen
// müsste.
async function tempConfigDir(t: { after: (fn: () => void) => void }) {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const configDir = join(dir, 'config');
  await mkdir(configDir, { recursive: true });
  return { configDir, schreibe: (name: string, data: unknown) =>
    writeFile(join(configDir, name), JSON.stringify(data), 'utf8') };
}

test('loadSources liest aus dem uebergebenen configDir, nicht aus dem Repo', async (t) => {
  const { configDir, schreibe } = await tempConfigDir(t);
  await schreibe('sources.json', { 'karriere.at': { enabled: false, queries: [{ keyword: 'nur-hier' }] } });
  assert.deepEqual(loadSources(configDir), { 'karriere.at': { enabled: false, queries: [{ keyword: 'nur-hier' }] } });
});

test('loadLocationConfig folgt dem uebergebenen configDir', async (t) => {
  const { configDir, schreibe } = await tempConfigDir(t);
  await schreibe('location.json', { cities: ['Testhausen'], regions: [], remote: [] });
  assert.deepEqual(loadLocationConfig(configDir).cities, ['Testhausen']);
});

test('loadSettings folgt dem uebergebenen configDir', async (t) => {
  const { configDir, schreibe } = await tempConfigDir(t);
  await schreibe('settings.json', { filterMode: 'llm', filterModel: 'testmodell' });
  assert.equal(loadSettings(configDir).filterModel, 'testmodell');
});

// Die eine, die es schon immer richtig machte — mitgeprüft, damit die Reihe vollständig
// ist und niemand sie beim nächsten Umbau in die andere Richtung "vereinheitlicht".
// (Sie las den Pfad bis September 2026 als einzige fest verdrahtet statt über
// config.configDir — gleiches Ergebnis, solange configDir "config" ist, aber eben
// nur solange. Jetzt geht sie denselben Weg wie die anderen vier.)
test('loadProfile folgt dem uebergebenen configDir', async (t) => {
  const { configDir, schreibe } = await tempConfigDir(t);
  await schreibe('profile.json', { name: 'Test Person' });
  assert.equal(loadProfile(configDir).name, 'Test Person');
});

// Die fünfte im Bunde, bisher hier nicht vertreten.
test('loadExperienceRules folgt dem uebergebenen configDir', async (t) => {
  const { configDir, schreibe } = await tempConfigDir(t);
  await schreibe('experience-rules.json', { minYears: 42, experienceWords: ['nur-hier'], disqualifyingPhrases: [], optionalMarkers: [], negationMarkers: [], juniorSignals: [], codingKeywords: [] });
  assert.equal(loadExperienceRules(configDir).minYears, 42);
});

test('fehlende Datei im configDir wird nicht still aus dem Repo ersetzt', async (t) => {
  const { configDir } = await tempConfigDir(t);
  assert.throws(() => loadSettings(configDir), /settings\.json fehlt/);
});
