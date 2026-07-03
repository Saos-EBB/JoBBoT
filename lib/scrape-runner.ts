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
  maxConcurrent?: number;
  maxBrowsers?: number;
}

// Ein Scheduler statt zwei unabhängiger Semaphoren: acquire() prüft BEIDE Limits
// atomar und committet nur, wenn beide Platz haben — sonst wird gewartet, ohne
// eines der beiden Kontingente teilweise zu belegen. Zwei getrennte Semaphoren
// (erst Browser-Slot, dann Gesamt-Slot) führten im Live-Lauf zu Starvation: ein
// Browser-Adapter griff sich zuerst den knappen Browser-Slot, hing dann aber in
// der Gesamt-Slot-Queue fest — und blockierte damit den zweiten Browser-Adapter
// von seinem eigentlich freien Browser-Slot, teils minutenlang. release() weckt
// alle Wartenden; nur wer beide Limits jetzt erfüllt, kommt tatsächlich durch.
function createScheduler(maxConcurrent: number, maxBrowsers: number) {
  let active = 0;
  let activeBrowsers = 0;
  let queue: (() => void)[] = [];

  function tryAcquire(isBrowser: boolean): boolean {
    if (active >= maxConcurrent) return false;
    if (isBrowser && activeBrowsers >= maxBrowsers) return false;
    active++;
    if (isBrowser) activeBrowsers++;
    return true;
  }

  async function acquire(isBrowser: boolean): Promise<void> {
    while (!tryAcquire(isBrowser)) {
      await new Promise<void>(resolve => queue.push(resolve));
    }
  }

  function release(isBrowser: boolean): void {
    active--;
    if (isBrowser) activeBrowsers--;
    const waiting = queue;
    queue = [];
    waiting.forEach(resolve => resolve());
  }

  return { acquire, release };
}

// Alle Quellen parallel, aber gedrosselt: max `maxConcurrent` Adapter gleichzeitig
// insgesamt, UND max `maxBrowsers` kind:"browser"-Adapter gleichzeitig — nie zwei
// Playwright-Browser parallel, die sich lokal um CPU/Netzwerk streiten. allSettled
// bleibt: ein Adapter-Fehler stoppt die anderen nicht. Dedup+Save erst NACH allen
// Ergebnissen sequenziell (verhindert Write-Races, wenn dieselbe Stelle auf zwei
// Quellen mit gleicher jobId auftaucht).
export async function runScrape(options: RunScrapeOptions): Promise<SourceOutcome[]> {
  const { names, registry, queriesFor, keep, storage, onProgress, maxConcurrent = 2, maxBrowsers = 1 } = options;

  const scheduler = createScheduler(maxConcurrent, maxBrowsers);

  const settled = await Promise.allSettled(names.map(async name => {
    const isBrowser = registry[name].kind === 'browser';
    await scheduler.acquire(isBrowser);
    try {
      return await registry[name].scrape(
        queriesFor(name),
        keep,
        (current, total) => onProgress?.(name, current, total),
      );
    } finally {
      scheduler.release(isBrowser);
    }
  }));

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
