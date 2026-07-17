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

// status und fit sind jetzt 1:1 gekoppelt (User-Entscheidung, um die zwei parallelen
// Taxonomien nicht mehr auseinanderlaufen zu lassen): matched=sicher/save→match,
// uncertain=unsicher/unsave→offstack, filtered_out=aussortiert→brutal. fit bleibt
// trotzdem ein eigenes, manuell überschreibbares Feld (fitpick in ui/app.tsx) — dieser
// Filter-Lauf setzt nur den Startwert, spätere manuelle Korrektur bleibt möglich.
const STATUS_FIT: Record<FilterDecision['status'], Job['fit']> = {
  matched: 'match',
  uncertain: 'offstack',
  filtered_out: 'brutal',
};

// filtered_out wird NICHT gelöscht (kein storage.delete): verlustfrei und re-runnbar.
// Ein abgelehnter Job bleibt als Datei erhalten, nur der Status ändert sich.
export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost, mode?: FilterMode): Promise<FilterDecision> {
  const result = await decide(job, { ollama, mode });
  const patch: Partial<Job> = { status: result.status, fit: STATUS_FIT[result.status] };

  // storage.update() re-reads the CURRENT on-disk job and merges the patch in,
  // instead of saving this whole (possibly stale) `job` object back — narrows
  // the lost-update window against a concurrent browser edit (e.g. the user
  // changing `fit` via the UI) to a plain get→save race, not a guaranteed
  // overwrite. Still not a full compare-and-swap (JsonStore has none); accepted
  // as a single-user local tool's residual risk, not chased further.
  const updated = await storage.update(job.id, patch);

  return { job: updated, status: result.status, rejectedBy: result.rejectedBy, judgment: result.judgment };
}
