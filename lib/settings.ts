import { readFileSync } from 'node:fs';

export type FilterMode = 'llm' | 'regex';

export interface Settings {
  filterMode: FilterMode;
}

export function loadSettings(): Settings {
  const path = new URL('../config/settings.json', import.meta.url);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error('config/settings.json fehlt.');
  }
  return JSON.parse(raw) as Settings;
}
