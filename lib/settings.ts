import { config } from '../config.ts';
import { loadJsonConfig } from './load-json-config.ts';

export type FilterMode = 'llm' | 'regex';

export interface Settings {
  filterMode: FilterMode;
  filterModel: string;
}

export function loadSettings(configDir: string = config.configDir): Settings {
  const parsed = loadJsonConfig<Partial<Settings>>(configDir, 'settings.json', {
    onMissing: () => 'config/settings.json fehlt.',
  });
  return {
    filterMode: parsed.filterMode ?? 'regex',
    filterModel: parsed.filterModel ?? 'mistral-small3.2:latest',
  };
}
