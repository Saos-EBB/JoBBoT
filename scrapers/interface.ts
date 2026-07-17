// Pipeline-Zone (Scraper/Filter/Anschreiben) — nur von lib/filter-decide.ts und
// lib/anschreiben.ts geschrieben, hier unangetastet. UI-Zone — nur vom UI geschrieben
// (bisher scripts/ui-server.ts, komplett ersetzt); literal umbenannt statt derived,
// weil kein anderer Code diese Werte je schreibt.
// "triaged" ersetzt die vormals getrennten filtered_out/uncertain/matched — das Urteil
// selbst lebt jetzt ausschließlich in `fit` (einheitliches Vokabular, kein zweites Feld
// das dieselbe Aussage in anderen Worten trifft).
export type JobStatus =
  | 'new' | 'triaged' | 'generated'
  | 'freigegeben' | 'postausgang' | 'gesendet' | 'geloescht' | 'fehler';

export type Fit = 'matched' | 'offstack' | 'brutal';

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
  // Nur der Status "fehler" verweist hierauf. Noch niemand schreibt dieses Feld — der
  // Runner-Umbau in run-anschreiben.ts/den Mail-Handlern ist ein separater Auftrag
  // (siehe findings/HANDOFF-gmail-versand.md). Bis dahin ist es ehrlich immer leer.
  error?: string | null;
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
