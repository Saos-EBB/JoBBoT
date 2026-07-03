import { readFileSync } from 'node:fs';

export interface ProfileData {
  name: string;
  job_title: string;
  quereinstieg: { bootcamp: string; abschluss: string; hintergrund: string; story_url?: string };
  skills: { sprachen: string[]; frontend: string[]; backend: string[]; datenbanken: string[]; tools: string[] };
  sprachkenntnisse: string[];
  links?: { website?: string; github?: string };
  projekte: Array<{ name: string; beschreibung: string; tech?: string[]; anchor?: boolean }>;
}

export function loadProfile(): ProfileData {
  try {
    return JSON.parse(readFileSync('config/profile.json', 'utf8')) as ProfileData;
  } catch {
    throw new Error('config/profile.json fehlt — kopiere config/profile.example.json und fülle es aus');
  }
}
