import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { config } from '../config.ts';
import { decide } from './filter-decide.ts';
import type { FilterJudgment } from './filter-llm.ts';

export interface FilterDecision {
  job: Job;
  status: 'matched' | 'uncertain' | 'filtered_out';
  rejectedBy?: string;
  judgment?: FilterJudgment;
}

// filtered_out wird NICHT gelöscht (kein storage.delete): verlustfrei und re-runnbar.
// Ein abgelehnter Job bleibt als Datei erhalten, nur der Status ändert sich.
export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost): Promise<FilterDecision> {
  const result = await decide(job, { ollama });

  job.status = result.status;
  job.updatedAt = new Date().toISOString();
  await storage.save(job);

  return { job, status: result.status, rejectedBy: result.rejectedBy, judgment: result.judgment };
}
