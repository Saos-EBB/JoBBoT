import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LoadJsonConfigOptions {
  // Ersetzt die native Fehlermeldung bei fehlender Datei durch diese, bekommt den
  // vollen Pfad übergeben. Ohne diese Option propagiert der native fs-Fehler.
  onMissing?: (path: string) => string;
  // Wendet onMissing auch auf JSON.parse-Fehler an, nicht nur auf fehlende Dateien.
  // Ohne dies (Default) propagiert ein Parse-Fehler nativ (SyntaxError).
  wrapParseErrors?: boolean;
}

// Ein Ort für das readFileSync+join+JSON.parse, das an fünf Stellen (lib/sources.ts,
// settings.ts, profile.ts, location.ts, experience-regex.ts) wortgleich stand. Die
// Loader unterscheiden sich nur darin, OB und WIE sie eine fehlende Datei melden —
// das bildet onMissing/wrapParseErrors ab, ohne dass ein Loader mehr Verhalten verliert.
export function loadJsonConfig<T>(configDir: string, filename: string, opts?: LoadJsonConfigOptions): T {
  const path = join(configDir, filename);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (opts?.onMissing) throw new Error(opts.onMissing(path));
    throw err;
  }
  if (opts?.wrapParseErrors && opts.onMissing) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(opts.onMissing(path));
    }
  }
  return JSON.parse(raw) as T;
}
