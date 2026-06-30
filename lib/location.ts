import { readFileSync } from 'node:fs';

interface LocationConfig { cities: string[]; regions: string[]; remote: string[] }

// Genauer Länder-Match: unbekannter Ort → behalten, Detail/LLM/Mensch entscheidet
const COUNTRY_ONLY = ['österreich', 'oesterreich', 'austria', 'at'];

export function isInRange(location: string, cfg: LocationConfig): boolean {
  const loc = location.trim();
  if (!loc) return true;
  const low = loc.toLowerCase();
  if (COUNTRY_ONLY.includes(low)) return true; // exakter Match, kein Substring
  const all = [...cfg.cities, ...cfg.regions, ...cfg.remote];
  return all.some(term => low.includes(term.toLowerCase()));
}

export function loadLocationConfig(): LocationConfig {
  const path = new URL('../config/location.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as LocationConfig;
}
