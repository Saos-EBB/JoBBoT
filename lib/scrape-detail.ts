import type { ScrapedJob } from '../scrapers/interface.ts';
import { createBatcher } from './grid-batch.ts';

export interface DetailPhaseOptions {
  source: string;
  // Holt und parst die Detailseite EINES Kandidaten. Wirft der Fetch/Parse, behält der
  // Durchlauf den Basis-Job und läuft weiter — ein kaputtes Inserat kostet nicht den Lauf.
  fetchDetail: (job: ScrapedJob) => Promise<ScrapedJob>;
  onProgress?: (current: number, total: number) => void;
  onUnitDone?: (items: ScrapedJob[]) => void;
  // Gesetzt → onUnitDone wird in festen Blöcken dieser Größe gemeldet (karriere.at,
  // jobs.at: keine echte Suchergebnis-Pagination, deshalb Detail-Phase gebündelt).
  // Weggelassen → in dieser Phase kein onUnitDone (linkedin, devjobs melden schon in
  // der Suchphase pro Seite).
  batchSize?: number;
}

// Der Detail-Fetch-Durchlauf, den karriere-at/jobs-at/linkedin/devjobs Zeile für Zeile
// gleich nachbauten: pro Kandidat onProgress, Detail holen+parsen, bei Fehler den
// Basis-Job behalten und weiterlaufen, optional gebündelt an onUnitDone melden. Lebt
// jetzt an einer Stelle statt viermal — Fehlerverhalten und Batching einmal testbar.
export async function runDetailPhase(candidates: ScrapedJob[], opts: DetailPhaseOptions): Promise<ScrapedJob[]> {
  const { source, fetchDetail, onProgress, onUnitDone, batchSize } = opts;
  const total = candidates.length;
  const results: ScrapedJob[] = [];
  const batcher = batchSize ? createBatcher(batchSize, onUnitDone) : null;

  for (let i = 0; i < total; i++) {
    const job = candidates[i];
    onProgress?.(i + 1, total);
    let result = job;
    try {
      result = await fetchDetail(job);
    } catch (err) {
      console.warn(`[${source}] detail fehlgeschlagen: ${job.url}`, err);
    }
    results.push(result);
    batcher?.push(result);
  }
  batcher?.flush();
  return results;
}
