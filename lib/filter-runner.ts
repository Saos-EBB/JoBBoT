import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { filterJob } from './filter.ts';
import type { FilterDecision } from './filter.ts';
import { writeFilterReport } from './filter-report.ts';
import { loadSettings } from './settings.ts';
import type { FilterMode } from './settings.ts';

// Das Geschwister zu lib/scrape-runner.ts und lib/anschreiben-runner.ts: die eine
// Filter-Schleife, die sich CLI und UI teilen. Vorher stand sie zweimal — in
// scripts/run-filter.ts und im /api/filter-Handler — und beide Kopien waren ungetestet.
//
// Sichtbare Folge dieser Doppelung: nur das CLI rief writeFilterReport(). Ein
// Filter-Lauf aus der UI schrieb nichts nach data/filter-log.md, und damit gingen
// genau die LLM-Urteile verloren, die dort zum Vergleich mit den Regex-Urteilen
// gesammelt werden sollen. Deshalb schreibt jetzt der Runner den Bericht, nicht
// der Aufrufer — vergessen kann ihn so keiner mehr.

export type FilterScope = 'new' | 'all';

export interface RunFilterOptions {
  storage: Storage;
  // "all" triagiert jede vorhandene Job-Datei neu (z.B. nach einer Regel-Änderung),
  // "new" nur die noch ungefilterten.
  scope?: FilterScope;
  // Ohne Angabe entscheidet config/settings.json.
  mode?: FilterMode;
  ollama?: string;
  // Vor dem Urteil — das CLI startet damit seinen Spinner, die UI setzt ihren
  // Fortschrittszustand, bevor der (im llm-Modus langsame) Aufruf beginnt.
  onProgress?: (i: number, total: number, job: Job) => void;
  // Nach dem Urteil: eine Zeile im Terminal bzw. ein Quadrat im Lade-Grid.
  onDecision?: (decision: FilterDecision, i: number, total: number) => void;
  // Injizierbar wie checkOnline in lib/scrape-runner.ts, damit Tests den Lauf ohne
  // Ollama und ohne Regel-Dateien durchspielen können. Was filterJob() selbst
  // entscheidet, deckt test/filter.test.ts ab — hier geht es um die Schleife.
  filter?: (job: Job) => Promise<FilterDecision>;
  writeReport?: (decisions: FilterDecision[], mode: FilterMode) => void;
}

export interface FilterOutcome {
  // Der tatsächlich gelaufene Modus, nicht der angefragte — der Bericht und die
  // Zusammenfassung sollen sagen, was passiert ist, nicht was gewünscht war.
  mode: FilterMode;
  matched: number;
  offstack: number;
  brutal: number;
  decisions: FilterDecision[];
}

export async function runFilter(options: RunFilterOptions): Promise<FilterOutcome> {
  const {
    storage, scope = 'new', ollama, onProgress, onDecision,
    writeReport = (decisions, mode) => writeFilterReport(decisions, undefined, mode),
  } = options;

  // Einmal aufgelöst statt pro Job: resolveStrategy() liest sonst für jeden Job
  // config/settings.json neu, und eine Änderung mitten im Lauf beurteilte die zweite
  // Hälfte anders als die erste.
  const mode = options.mode ?? loadSettings().filterMode;
  const filter = options.filter ?? (job => filterJob(job, storage, ollama, mode));

  const jobs = await storage.list(scope === 'all' ? undefined : { status: 'new' });

  const decisions: FilterDecision[] = [];
  let matched = 0, offstack = 0, brutal = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    onProgress?.(i, jobs.length, job);
    const decision = await filter(job);
    decisions.push(decision);
    if (decision.status === 'matched') matched++;
    else if (decision.status === 'uncertain') offstack++;
    else brutal++;
    onDecision?.(decision, i, jobs.length);
  }

  // Kein Bericht ohne Entscheidungen: ein leerer Lauf hängt sonst einen Kopf ohne
  // Inhalt ans Log. Entspricht dem bisherigen CLI-Verhalten (es stieg bei 0 Jobs
  // vor dem Schreiben aus).
  if (decisions.length > 0) writeReport(decisions, mode);

  return { mode, matched, offstack, brutal, decisions };
}
