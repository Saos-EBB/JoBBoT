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

  // Nur "matched" bekommt automatisch fit="match" — das ist das einzige Urteil,
  // das der Filter (regex ODER llm) mit echter Sicherheit trifft. "uncertain"/
  // "filtered_out" bleiben unangetastet (fit=null): der Filter kann Tech-Stack-
  // Mismatch (offstack) nicht von großem Mismatch (brutal) unterscheiden — ein
  // geratener Wert sähe identisch zu einem echten Urteil aus und wäre damit
  // schlimmer als gar keiner (siehe ui/app.tsx, fitColor()).
  const patch: Partial<Job> = { status: result.status };
  if (result.status === 'matched') patch.fit = 'match';

  // storage.update() re-reads the CURRENT on-disk job and merges the patch in,
  // instead of saving this whole (possibly stale) `job` object back — narrows
  // the lost-update window against a concurrent browser edit (e.g. the user
  // changing `fit` via the UI) to a plain get→save race, not a guaranteed
  // overwrite. Still not a full compare-and-swap (JsonStore has none); accepted
  // as a single-user local tool's residual risk, not chased further.
  const updated = await storage.update(job.id, patch);

  return { job: updated, status: result.status, rejectedBy: result.rejectedBy, judgment: result.judgment };
}
