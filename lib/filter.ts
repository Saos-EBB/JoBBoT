import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { config } from '../config.ts';
import { runCascade } from './filter-cascade.ts';
import type { StageLog, CascadeOptions } from './filter-cascade.ts';

export interface FilterDecision {
  job: Job;
  status: 'matched' | 'uncertain' | 'filtered_out';
  stages: StageLog[];
  rejectedBy?: string;
}

// filtered_out wird NICHT gelöscht (kein storage.delete): verlustfrei und re-runnbar.
// Ein per Kaskade abgelehnter Job bleibt als Datei erhalten, nur der Status ändert sich.
export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost): Promise<FilterDecision> {
  const options: CascadeOptions = { ollama };
  const result = await runCascade(job, options);

  job.status = result.status;
  job.updatedAt = new Date().toISOString();
  await storage.save(job);

  return { job, status: result.status, stages: result.stages, rejectedBy: result.rejectedBy };
}
