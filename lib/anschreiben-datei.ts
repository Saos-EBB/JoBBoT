import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { slugify } from './slugify.ts';
import { config } from '../config.ts';

// Wo das Anschreiben eines Jobs liegt — die EINE Stelle, die das entscheidet.
//
// Vorher leiteten vier Stellen (lib/anschreiben.ts, scripts/ui-server.ts zweimal,
// mail/gmail.ts) den Pfad selbst aus jobBasename(job) ab. Der trägt Titel, Firma,
// DATUM und id-Präfix — und das Datum ist kein Teil der Identität, sondern ein Wert,
// der sich ändert:
//
//   Re-Scrape       liefert ein neues postedAt      -> anderer Dateiname
//   Duplikat-Merge  setzt keep.scrapedAt auf das des ältesten Zwillings
//                   (siehe planMerge)                -> anderer Dateiname
//
// In beiden Fällen war der bereits geschriebene Brief für seinen eigenen Job
// unsichtbar. Am 2026-09-04 betraf das 46 von 101 Dateien im Bestand.
//
// Gefunden wird deshalb ausschließlich über das id-Präfix; der lesbare Teil des
// Namens ist Dekoration. Dasselbe Muster benutzt JsonStore.findFile() für die
// Job-Dateien — dort aus genau demselben Grund.

// Kurzform der id, wie sie am Dateinamen hängt. 8 Hex-Zeichen, identisch zu
// storage/json-store.ts — dieselbe Länge, damit beide Ordner gleich zu lesen sind.
const idSuffix = (id: string) => `_${id.slice(0, 8)}`;

// Name für eine NEU geschriebene Datei. Ohne Datum, sonst wäre das Problem oben
// beim nächsten Re-Scrape zurück.
export function anschreibenName(job: { title: string; company: string; id: string }): string {
  return `${slugify(job.title)}_${slugify(job.company)}${idSuffix(job.id)}`;
}

// Der Pfad des vorhandenen Anschreibens, oder null. Sucht per id-Präfix, findet damit
// auch Dateien aus dem alten Schema (mit Datum im Namen) — die Migration ist deshalb
// Aufräumen, keine Voraussetzung.
export async function findAnschreiben(job: { id: string }, dir = config.anschreibenDir): Promise<string | null> {
  const suffix = `${idSuffix(job.id)}.md`;
  try {
    const treffer = (await readdir(dir)).find(f => f.endsWith(suffix));
    return treffer ? join(dir, treffer) : null;
  } catch {
    // Ordner existiert (noch) nicht — dann gibt es auch kein Anschreiben.
    return null;
  }
}

// Der Pfad, unter dem geschrieben werden soll — plus das Aufräumen einer Datei, die
// denselben Job unter einem alten Namen meint. Ohne das läge nach dem ersten Schreiben
// im neuen Schema eine zweite Datei für denselben Job herum, und welche von beiden
// findAnschreiben() erwischt, wäre der readdir-Reihenfolge überlassen.
// Gleiches Muster wie JsonStore.save().
export async function anschreibenZiel(
  job: { title: string; company: string; id: string },
  dir = config.anschreibenDir,
): Promise<string> {
  const ziel = join(dir, `${anschreibenName(job)}.md`);
  const alt = await findAnschreiben(job, dir);
  if (alt && alt !== ziel) await unlink(alt).catch(() => { /* schon weg */ });
  return ziel;
}
