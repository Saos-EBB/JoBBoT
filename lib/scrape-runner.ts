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

// Simple Zähl-Semaphore, kein neues Runtime-Dep. acquire() löst sofort auf wenn
// noch Platz ist, sonst wartet der Aufrufer in der FIFO-Queue auf release().
function createSlot(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return {
    acquire(): Promise<void> {
      if (active < max) { active++; return Promise.resolve(); }
      return new Promise<void>(resolve => queue.push(resolve));
    },
    release(): void {
      active--;
      const next = queue.shift();
      if (next) { active++; next(); }
    },
  };
}

// Alle Quellen parallel, aber gedrosselt: max `maxConcurrent` Adapter gleichzeitig
// insgesamt, UND max `maxBrowsers` kind:"browser"-Adapter gleichzeitig (eigener
// Slot zusätzlich zum globalen) — nie zwei Playwright-Browser parallel, die sich
// lokal um CPU/Netzwerk streiten. allSettled bleibt: ein Adapter-Fehler stoppt
// die anderen nicht. Dedup+Save erst NACH allen Ergebnissen sequenziell
// (verhindert Write-Races, wenn dieselbe Stelle auf zwei Quellen mit gleicher
// jobId auftaucht).
export async function runScrape(options: RunScrapeOptions): Promise<SourceOutcome[]> {
  const { names, registry, queriesFor, keep, storage, onProgress, maxConcurrent = 2, maxBrowsers = 1 } = options;

  const totalSlot = createSlot(maxConcurrent);
  const browserSlot = createSlot(maxBrowsers);

  // Reihenfolge WICHTIG: der Browser-Slot (der engere Engpass) wird zuerst
  // erworben. Andersrum (totalSlot zuerst) kann ein Browser-Adapter einen
  // allgemeinen Slot belegen während er noch auf den Browser-Slot wartet — das
  // blockiert einen wartenden Fetch-Adapter unnötig, obwohl der sofort loslegen
  // könnte (Starvation, beobachtet im Live-Lauf: ams hielt den zweiten
  // Gesamt-Slot fest, während devjobs.at den Browser-Slot belegte, und jobs.at
  // blieb hinter ams in der Gesamt-Slot-Queue stecken statt parallel zu laufen).
  const settled = await Promise.allSettled(names.map(async name => {
    const isBrowser = registry[name].kind === 'browser';
    if (isBrowser) await browserSlot.acquire();
    await totalSlot.acquire();
    try {
      return await registry[name].scrape(
        queriesFor(name),
        keep,
        (current, total) => onProgress?.(name, current, total),
      );
    } finally {
      totalSlot.release();
      if (isBrowser) browserSlot.release();
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
