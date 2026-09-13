import type { ScrapedJob } from '../scrapers/interface.ts';
import { logLocationGate } from './scrape-log.ts';

// Gemeinsamer Abschluss der Suchphase, bisher in karriere-at.ts, ams.ts und linkedin.ts
// dreifach identisch nachgebaut: URL-Dedup (erster Treffer gewinnt) → optionaler
// keep-Filter → Location-Gate-Log, in genau dieser Reihenfolge.
export function finalizeResults(
  source: string,
  jobs: ScrapedJob[],
  keep?: (job: ScrapedJob) => boolean,
): ScrapedJob[] {
  const byUrl = new Map<string, ScrapedJob>();
  for (const job of jobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
  const allJobs = [...byUrl.values()];
  const candidates = keep ? allJobs.filter(keep) : allJobs;
  logLocationGate(source, allJobs.length, candidates.length);
  return candidates;
}
