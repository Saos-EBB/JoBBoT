import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { config } from '../config.ts';
import { decide } from './filter-decide.ts';
import type { FilterJudgment } from './filter-llm.ts';
import type { FilterMode } from './settings.ts';

export interface FilterDecision {
  job: Job;
  status: 'matched' | 'uncertain' | 'filtered_out';
  rejectedBy?: string;
  judgment?: FilterJudgment;
}

// filtered_out wird NICHT gelöscht (kein storage.delete): verlustfrei und re-runnbar.
// Ein abgelehnter Job bleibt als Datei erhalten, nur der Status ändert sich.
export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost, mode?: FilterMode): Promise<FilterDecision> {
  const result = await decide(job, { ollama, mode });

  // storage.update() re-reads the CURRENT on-disk job and merges just `status`
  // in, instead of saving this whole (possibly stale) `job` object back —
  // narrows the lost-update window against a concurrent browser edit (e.g. the
  // user changing `fit` via the UI) to a plain get→save race, not a guaranteed
  // overwrite. Still not a full compare-and-swap (JsonStore has none); accepted
  // as a single-user local tool's residual risk, not chased further.
  const updated = await storage.update(job.id, { status: result.status });

  return { job: updated, status: result.status, rejectedBy: result.rejectedBy, judgment: result.judgment };
}
