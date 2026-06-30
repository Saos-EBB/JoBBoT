import { readFileSync } from 'node:fs';

export type SourceQuery = Record<string, string>;
interface SourceConfig { enabled: boolean; queries: SourceQuery[] }
export type SourcesConfig = Record<string, SourceConfig>;

export function loadSources(): SourcesConfig {
  const path = new URL('../config/sources.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as SourcesConfig;
}
