import { readFileSync } from 'node:fs';

interface LocationConfig { cities: string[]; regions: string[]; remote: string[] }

export function isInRange(location: string, cfg: LocationConfig): boolean {
  const loc = location.trim();
  if (!loc) return true;
  const low = loc.toLowerCase();
  const all = [...cfg.cities, ...cfg.regions, ...cfg.remote];
  return all.some(term => low.includes(term.toLowerCase()));
}

export function loadLocationConfig(): LocationConfig {
  const path = new URL('../config/location.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as LocationConfig;
}
