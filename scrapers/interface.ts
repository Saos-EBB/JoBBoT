// Pipeline-Zone (Scraper/Filter/Anschreiben) — nur von lib/filter-decide.ts und
// lib/anschreiben.ts geschrieben, hier unangetastet. UI-Zone — nur vom UI geschrieben
// (bisher scripts/ui-server.ts, komplett ersetzt); literal umbenannt statt derived,
// weil kein anderer Code diese Werte je schreibt.
export type JobStatus =
  | 'new' | 'filtered_out' | 'uncertain' | 'matched' | 'generated'
  | 'freigegeben' | 'postausgang' | 'gesendet' | 'geloescht' | 'fehler';

export type Fit = 'match' | 'offstack' | 'brutal';

export interface ScrapedJob {
  source: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  description: string;
  postedAt?: string | null;
  salary?: string | null;
}

export interface Job extends ScrapedJob {
  id: string;
  status: JobStatus;
  fit: Fit | null;
  scrapedAt: string;
  updatedAt: string;
  match?: { ok: boolean; reason: string } | null;
  email?: string | null;
}

export type SourceQuery = Record<string, string>;

export interface ScraperAdapter {
  name: string;
  kind: 'fetch' | 'browser';
  scrape(
    queries: SourceQuery[],
    keep?: (job: ScrapedJob) => boolean,
    onProgress?: (current: number, total: number) => void,
  ): Promise<ScrapedJob[]>;
}
