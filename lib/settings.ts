import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';

export type FilterMode = 'llm' | 'regex';

export interface Settings {
  filterMode: FilterMode;
  filterModel: string;
}

export function loadSettings(): Settings {
  const path = join(config.configDir, 'settings.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error('config/settings.json fehlt.');
  }
  const parsed = JSON.parse(raw) as Partial<Settings>;
  return {
    filterMode: parsed.filterMode ?? 'regex',
    filterModel: parsed.filterModel ?? 'mistral-small3.2:latest',
  };
}
