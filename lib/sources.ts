import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';

// Re-Export statt zweiter Definition: derselbe Typ stand bis hierher auch in
// scrapers/interface.ts, und zwei Wahrheiten über dieselbe Form driften auseinander.
export type { SourceQuery } from '../scrapers/interface.ts';
import type { SourceQuery } from '../scrapers/interface.ts';
interface SourceConfig { enabled: boolean; queries: SourceQuery[] }
export type SourcesConfig = Record<string, SourceConfig>;

export function loadSources(): SourcesConfig {
  const path = join(config.configDir, 'sources.json');
  return JSON.parse(readFileSync(path, 'utf8')) as SourcesConfig;
}
