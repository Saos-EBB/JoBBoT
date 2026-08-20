import { karriereAtAdapter } from '../scrapers/karriere-at.ts';
import { devJobsAtAdapter } from '../scrapers/devjobs-at.ts';
import { linkedinAdapter } from '../scrapers/linkedin.ts';
import { amsAdapter } from '../scrapers/ams.ts';
import { jobsAtAdapter } from '../scrapers/jobs-at.ts';
import { loadLocationConfig, isInRange } from './location.ts';
import type { ScraperAdapter, ScrapedJob } from '../scrapers/interface.ts';

// Ein Aufruf pro Scrape-Lauf statt Modul-Level-Konstanten: ui-server.ts ist ein
// langlebiger Prozess (im Gegensatz zum CLI-Skript, das pro Lauf frisch startet) —
// gecachte config/location.json würde Änderungen erst nach einem Server-Neustart
// sehen.
// Die Liste der Portale, die es gibt. Bewusst hier und nicht aus config/sources.json
// abgeleitet: ein Portal braucht einen Adapter, und den kann keine JSON-Datei mitbringen.
// sources.json konfiguriert nur, was hier steht — sie kann nichts erfinden.
//
// Einzeln exportiert, weil Aufrufer die Liste oft ohne den Location-Filter brauchen
// (/api/scrape/sources, später das Einstellungsformular) und loadLocationConfig() dafür
// unnötig Datei-I/O wäre.
export const adapterRegistry: Record<string, ScraperAdapter> = {
  'karriere.at': karriereAtAdapter,
  'devjobs.at': devJobsAtAdapter,
  'linkedin': linkedinAdapter,
  'ams': amsAdapter,
  'jobs.at': jobsAtAdapter,
};

export function buildScrapeSetup(): { registry: Record<string, ScraperAdapter>; keep: (job: ScrapedJob) => boolean } {
  const registry = adapterRegistry;
  const locCfg = loadLocationConfig();
  const keep = (job: ScrapedJob) => isInRange(job.location ?? '', locCfg);
  return { registry, keep };
}
