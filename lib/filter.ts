import type { Job, JobStatus } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { config } from '../config.ts';
import { decide } from './filter-decide.ts';
import type { FilterJudgment } from './filter-llm.ts';
import type { FilterMode } from './settings.ts';

export interface TriagedDecision {
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
const STATUS_FIT: Record<TriagedDecision['status'], Job['fit']> = {
  matched: 'matched',
  uncertain: 'offstack',
  filtered_out: 'brutal',
};

// Ab wo ein Filter-Lauf den Status NICHT mehr anfassen darf. Ein Re-Triage (--scope=all
// bzw. "alle neu triagen" im UI) soll das URTEIL neu fällen, nicht die Pipeline
// zurückspulen: ein Job mit fertigem Anschreiben, eine freigegebene oder längst
// versendete Bewerbung ist keine offene Triage-Frage mehr.
//
// Genau das ist vorher passiert: filterJob() setzte status bedingungslos auf "triaged",
// also warf jeder scope=all-Lauf generated/freigegeben/postausgang/gesendet auf Anfang
// zurück. Im Bestand standen dadurch 21 nachweislich versendete Bewerbungen und 33 Jobs
// mit fertigem Anschreiben wieder im "Jobs"-Ordner — sichtbar nur noch daran, dass die
// Anschreiben-Datei älter war als das Job-JSON.
const TRIAGIERBAR = new Set<JobStatus>(['new', 'triaged']);

// filtered_out wird NICHT gelöscht (kein storage.delete): verlustfrei und re-runnbar.
// Ein abgelehnter Job bleibt als Datei erhalten, nur fit ändert sich (auf "brutal").
export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost, mode?: FilterMode): Promise<TriagedDecision> {
  const result = await decide(job, { ollama, mode });

  // Der Status wird am AKTUELLEN Diskstand entschieden, nicht am (womöglich veralteten)
  // `job` aus der Liste des Aufrufers — sonst spulte ein Lauf, der vor dem Anschreiben
  // gestartet ist, den Job nach dessen Fertigstellung doch noch zurück.
  const aktuell = (await storage.get(job.id)) ?? job;
  // `fit` wird immer neu gesetzt — das ist der Sinn des Laufs. Der Status nur, solange
  // der Job überhaupt noch in der Triage steckt.
  const patch: Partial<Job> = { fit: STATUS_FIT[result.status] };
  if (TRIAGIERBAR.has(aktuell.status)) patch.status = 'triaged';

  // storage.update() re-reads the CURRENT on-disk job and merges the patch in,
  // instead of saving this whole (possibly stale) `job` object back — narrows
  // the lost-update window against a concurrent browser edit (e.g. the user
  // changing `fit` via the UI) to a plain get→save race, not a guaranteed
  // overwrite. Still not a full compare-and-swap (JsonStore has none); accepted
  // as a single-user local tool's residual risk, not chased further.
  const updated = await storage.update(job.id, patch);

  return { job: updated, status: result.status, rejectedBy: result.rejectedBy, judgment: result.judgment };
}
