import { readFileSync } from 'node:fs';

export interface ProfileData {
  name: string;
  job_title: string;
  ausbildung: { abschluss: string; status: string };
  programming_languages: string[];
  frontend: string[];
  backend: string[];
  databases: string[];
  tools: string[];
  sprachen: string[];
  links?: { portfolio?: string; github?: string };
  projekte: Array<{ name: string; beschreibung: string }>;
  ueber_mich: string;
}

export function loadProfile(): ProfileData {
  try {
    return JSON.parse(readFileSync('config/profile.json', 'utf8')) as ProfileData;
  } catch {
    throw new Error('config/profile.json fehlt — kopiere config/profile.example.json und fülle es aus');
  }
}
