import type { Job } from '../scrapers/interface.ts';
import { checkTitle, isLehre } from './title-filter.ts';
import { buildStageInput } from './job-text.ts';
import { judgeJob } from './filter-llm.ts';
import type { FilterJudgment } from './filter-llm.ts';
import { config } from '../config.ts';

export interface Decision {
  status: 'matched' | 'uncertain' | 'filtered_out';
  rejectedBy?: string;
  judgment?: FilterJudgment;
}

export type Judge = (jobInput: string, isLehre: boolean) => Promise<FilterJudgment | null>;

export interface DecideOptions {
  judge?: Judge;
  ollama?: string;
}

function hasUnsicher(j: FilterJudgment): boolean {
  return j.it_rolle === 'unsicher' || j.erfahrung_ab_3j_erforderlich === 'unsicher' || j.lehre_coding === 'unsicher';
}

// Deterministische Gates vor dem 7b-Call: Titel-Seniorität spart den Call komplett.
// Danach EIN strukturiertes Urteil, das Code auf drei Fächer mappt. "unsicher" bzw.
// ein Parse-Fehler (judgment === null) zählt NIE als Reject — recall-sicher bleiben.
export async function decide(job: Job, options: DecideOptions = {}): Promise<Decision> {
  const ollama = options.ollama ?? config.ollamaHost;
  const judge: Judge = options.judge ?? ((input, lehre) => judgeJob(input, lehre, ollama));

  const titleVerdict = checkTitle(job.title);
  if (titleVerdict.excluded) {
    return { status: 'filtered_out', rejectedBy: 'Seniorität (Titel)' };
  }

  const lehre = isLehre(job.title);
  const input = buildStageInput(job);
  const judgment = await judge(input, lehre);

  if (!judgment) {
    return { status: 'uncertain' };
  }

  if (judgment.it_rolle === 'nein') return { status: 'filtered_out', rejectedBy: 'IT-Rolle', judgment };
  if (judgment.erfahrung_ab_3j_erforderlich === 'ja') return { status: 'filtered_out', rejectedBy: 'Erfahrung ≥3J', judgment };
  if (lehre && judgment.lehre_coding === 'nein') return { status: 'filtered_out', rejectedBy: 'Lehre nicht coding', judgment };

  if (judgment.junior_signal === 'ja' && !hasUnsicher(judgment)) {
    return { status: 'matched', judgment };
  }
  return { status: 'uncertain', judgment };
}
