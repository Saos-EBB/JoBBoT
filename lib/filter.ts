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

// Das Filter-Urteil selbst lebt nur noch in `fit` — Job.status wird für jedes Ergebnis
// einheitlich "triaged" (kein separater matched/uncertain/filtered_out-Status mehr, der
// dieselbe Aussage nochmal in anderen Worten trifft). fit bleibt trotzdem ein eigenes,
// manuell überschreibbares Feld (fitpick in ui/app.tsx) — dieser Filter-Lauf setzt nur
// den Startwert, spätere manuelle Korrektur bleibt möglich.
const STATUS_FIT: Record<FilterDecision['status'], Job['fit']> = {
  matched: 'matched',
  uncertain: 'offstack',
  filtered_out: 'brutal',
};

// filtered_out wird NICHT gelöscht (kein storage.delete): verlustfrei und re-runnbar.
// Ein abgelehnter Job bleibt als Datei erhalten, nur fit ändert sich (auf "brutal").
export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost, mode?: FilterMode): Promise<FilterDecision> {
  const result = await decide(job, { ollama, mode });
  const patch: Partial<Job> = { status: 'triaged', fit: STATUS_FIT[result.status] };

  // storage.update() re-reads the CURRENT on-disk job and merges the patch in,
  // instead of saving this whole (possibly stale) `job` object back — narrows
  // the lost-update window against a concurrent browser edit (e.g. the user
  // changing `fit` via the UI) to a plain get→save race, not a guaranteed
  // overwrite. Still not a full compare-and-swap (JsonStore has none); accepted
  // as a single-user local tool's residual risk, not chased further.
  const updated = await storage.update(job.id, patch);

  return { job: updated, status: result.status, rejectedBy: result.rejectedBy, judgment: result.judgment };
}
