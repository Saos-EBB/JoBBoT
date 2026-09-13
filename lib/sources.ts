import { config } from '../config.ts';
import { loadJsonConfig } from './load-json-config.ts';

// Re-Export statt zweiter Definition: derselbe Typ stand bis hierher auch in
// scrapers/interface.ts, und zwei Wahrheiten über dieselbe Form driften auseinander.
export type { SourceQuery } from '../scrapers/interface.ts';
import type { SourceQuery } from '../scrapers/interface.ts';
interface SourceConfig { enabled: boolean; queries: SourceQuery[] }
export type SourcesConfig = Record<string, SourceConfig>;

export function loadSources(configDir: string = config.configDir): SourcesConfig {
  return loadJsonConfig<SourcesConfig>(configDir, 'sources.json');
}
