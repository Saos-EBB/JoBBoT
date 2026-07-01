import type { ScraperAdapter, ScrapedJob, SourceQuery } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { toJob } from './normalize.ts';
import { jobId } from './hash.ts';

export interface SourceOutcome {
  name: string;
  ok: boolean;
  newCount: number;
  skipCount: number;
  error?: unknown;
}

export interface RunScrapeOptions {
  names: string[];
  registry: Record<string, ScraperAdapter>;
  queriesFor: (name: string) => SourceQuery[];
  keep?: (job: ScrapedJob) => boolean;
  storage: Storage;
  onProgress?: (name: string, current: number, total: number) => void;
}

// Alle Quellen parallel (allSettled — eine gescheiterte Quelle stoppt die anderen
// nicht), Dedup+Save erst NACH allen Ergebnissen sequenziell (verhindert Write-
// Races, wenn dieselbe Stelle auf zwei Quellen mit gleicher jobId auftaucht).
export async function runScrape(options: RunScrapeOptions): Promise<SourceOutcome[]> {
  const { names, registry, queriesFor, keep, storage, onProgress } = options;

  const settled = await Promise.allSettled(
    names.map(name => registry[name].scrape(
      queriesFor(name),
      keep,
      (current, total) => onProgress?.(name, current, total),
    )),
  );

  const outcomes: SourceOutcome[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const result = settled[i];

    if (result.status === 'rejected') {
      outcomes.push({ name, ok: false, newCount: 0, skipCount: 0, error: result.reason });
      continue;
    }

    let newCount = 0, skipCount = 0;
    for (const scraped of result.value) {
      const id = jobId(scraped);
      if (await storage.exists(id)) { skipCount++; }
      else { await storage.save(toJob(scraped)); newCount++; }
    }
    outcomes.push({ name, ok: true, newCount, skipCount });
  }
  return outcomes;
}
