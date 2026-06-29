export type JobStatus =
  | 'new' | 'filtered_out' | 'matched' | 'generated' | 'reviewed' | 'drafted' | 'sent';

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

export interface ScraperAdapter {
  name: string;
  fetchJobs(): Promise<ScrapedJob[]>;
}
