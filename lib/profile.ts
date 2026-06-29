import { readFileSync } from 'node:fs';

export interface ProfileData {
  name: string;
  ausbildung: string;
  skills: string[];
  sprachen: string[];
  erfahrung: string;
  ueber_mich: string;
}

export function loadProfile(): ProfileData {
  try {
    return JSON.parse(readFileSync('config/profile.json', 'utf8')) as ProfileData;
  } catch {
    throw new Error('config/profile.json fehlt — kopiere config/profile.example.json und fülle es aus');
  }
}
