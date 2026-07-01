export type JobStatus =
  | 'new' | 'filtered_out' | 'uncertain' | 'matched' | 'generated' | 'reviewed' | 'drafted' | 'sent';

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
  scrapedAt: string;
  updatedAt: string;
  match?: { ok: boolean; reason: string } | null;
}

export type SourceQuery = Record<string, string>;

export interface ScraperAdapter {
  name: string;
  scrape(
    queries: SourceQuery[],
    keep?: (job: ScrapedJob) => boolean,
    onProgress?: (msg: string) => void,
  ): Promise<ScrapedJob[]>;
}
