import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';

export interface ProfileData {
  name: string;
  job_title: string;
  quereinstieg: { bootcamp: string; abschluss: string; hintergrund: string; story_url?: string };
  skills: { sprachen: string[]; frontend: string[]; backend: string[]; datenbanken: string[]; tools: string[] };
  sprachkenntnisse: string[];
  links?: { website?: string; github?: string };
  projekte: Array<{ name: string; beschreibung: string; tech?: string[]; anchor?: boolean }>;
}

// Über config.configDir wie die vier Nachbar-Loader. Vorher stand der Pfad hier als
// einziger fest verdrahtet — heute derselbe Ort, weil configDir genau "config" ist,
// aber ein anderer Wert hätte profile.json still woanders gesucht als den Rest.
export function loadProfile(): ProfileData {
  const path = join(config.configDir, 'profile.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProfileData;
  } catch {
    throw new Error(`${path} fehlt — kopiere profile.example.json daneben und fülle es aus`);
  }
}
