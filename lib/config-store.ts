import { readFile, writeFile, rename, unlink, copyFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { config } from '../config.ts';
import { adapterRegistry } from './scrape-setup.ts';
import { checkQuery, describeProblem } from './query-schema.ts';

// Die Dateien, die die Einstellungsseite schreiben darf. Feste Zuordnung statt eines
// Pfads aus der Anfrage: der Server nimmt hier Schreibbefehle entgegen, und ein
// Dateiname aus dem Netz waere ein Pfad-Ausbruch mit Ansage.
export const CONFIG_FILES = {
  sources: 'sources.json',
  location: 'location.json',
} as const;

export type ConfigName = keyof typeof CONFIG_FILES;

export function isConfigName(s: string): s is ConfigName {
  return s in CONFIG_FILES;
}

// cwd-relativ wie alles andere in config.ts. Vorher zeigten diese Pfade ueber
// import.meta.url immer ins Repo, unabhaengig vom Arbeitsverzeichnis — ein PUT auf einen
// Server, der woanders gestartet wurde, schrieb trotzdem hierher.
const pfad = (name: ConfigName) => join(config.configDir, CONFIG_FILES[name]);
const bakPfad = (name: ConfigName) => `${pfad(name)}.bak`;

export async function readConfig(name: ConfigName): Promise<unknown> {
  return JSON.parse(await readFile(pfad(name), 'utf8'));
}

export async function hasBackup(name: ConfigName): Promise<boolean> {
  try { await stat(bakPfad(name)); return true; } catch { return false; }
}

// Schreiben wie JsonStore: erst in eine temporaere Datei, dann umbenennen. Ein
// abgebrochener Schreibvorgang darf keine halbe sources.json hinterlassen — sie wird bei
// jedem Scrape-Lauf frisch gelesen, eine kaputte bricht den naechsten Lauf.
//
// Davor wandert die bisherige Fassung nach <datei>.bak. Eine Stufe, mehr nicht: beide
// Dateien sind versioniert, alles Aeltere holt git — aber der Massstab dieser Seite ist
// jemand, der kein Terminal aufmacht, und fuer den gibt es git nicht.
export async function writeConfig(name: ConfigName, data: unknown): Promise<void> {
  const ziel = pfad(name);
  try { await copyFile(ziel, bakPfad(name)); } catch { /* erste Fassung, nichts zu sichern */ }
  const tmp = `${ziel}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmp, ziel);
}

// Holt die letzte Fassung zurueck und raeumt die Sicherung weg — nach dem Zurueckholen
// gibt es nichts mehr zurueckzuholen, und ein .bak, das gleich der Datei ist, waere ein
// Angebot, das ins Leere greift.
export async function restoreConfig(name: ConfigName): Promise<boolean> {
  if (!await hasBackup(name)) return false;
  await copyFile(bakPfad(name), pfad(name));
  await unlink(bakPfad(name));
  return true;
}

// ---------------------------------------------------------------- Pruefung

const istObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const istStringListe = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string');

// Geprueft wird server- UND clientseitig. Der Server darf sich nicht darauf verlassen,
// dass die Anfrage aus dem eigenen Formular kam.
export function validateSources(data: unknown): string[] {
  if (!istObjekt(data)) return ['Erwartet wird ein Objekt mit Portalnamen als Schlüssel.'];
  const fehler: string[] = [];
  for (const [name, cfg] of Object.entries(data)) {
    const adapter = adapterRegistry[name];
    // Die Registry ist die Wahrheit: sources.json konfiguriert nur, was es im Code gibt.
    if (!adapter) {
      fehler.push(`"${name}" ist kein bekanntes Portal — bekannt sind: ${Object.keys(adapterRegistry).join(', ')}`);
      continue;
    }
    if (!istObjekt(cfg)) { fehler.push(`"${name}": erwartet wird ein Objekt mit enabled und queries.`); continue; }
    if (typeof cfg.enabled !== 'boolean') fehler.push(`"${name}": enabled muss true oder false sein.`);
    if (!Array.isArray(cfg.queries)) { fehler.push(`"${name}": queries muss eine Liste sein.`); continue; }
    cfg.queries.forEach((q, i) => {
      if (!istObjekt(q) || Object.values(q).some(v => typeof v !== 'string')) {
        fehler.push(`"${name}" Anfrage ${i + 1}: alle Werte müssen Text sein.`);
        return;
      }
      for (const p of checkQuery(adapter.querySchema, q as Record<string, string>)) {
        fehler.push(`"${name}" Anfrage ${i + 1}: ${describeProblem(p)}`);
      }
    });
  }
  return fehler;
}

export function validateLocation(data: unknown): string[] {
  if (!istObjekt(data)) return ['Erwartet wird ein Objekt mit cities, regions und remote.'];
  const fehler: string[] = [];
  for (const gruppe of ['cities', 'regions', 'remote'] as const) {
    if (!istStringListe(data[gruppe])) fehler.push(`${gruppe} muss eine Liste aus Text sein.`);
  }
  for (const extra of Object.keys(data)) {
    if (!['cities', 'regions', 'remote'].includes(extra)) fehler.push(`Unbekannte Gruppe "${extra}".`);
  }
  return fehler;
}

export function validateConfig(name: ConfigName, data: unknown): string[] {
  return name === 'sources' ? validateSources(data) : validateLocation(data);
}
