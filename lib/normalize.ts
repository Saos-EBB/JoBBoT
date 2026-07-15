import type { Job, ScrapedJob } from '../scrapers/interface.ts';
import { jobId } from './hash.ts';

export function toJob(s: ScrapedJob): Job {
  const now = new Date().toISOString();
  return { ...s, id: jobId(s), status: 'new', fit: null, scrapedAt: now, updatedAt: now, match: null };
}
