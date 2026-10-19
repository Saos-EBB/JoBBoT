import type { Job } from '../scrapers/interface.ts';
import { checkTitle, isLehre } from './title-filter.ts';
import { regexStrategy } from './filter-regex.ts';
import { createNimbleStrategy } from './filter-nimble.ts';
import { FILTER_MODES, loadSettings } from './settings.ts';
import type { FilterMode } from './settings.ts';
import type { Decision, FilterStrategy } from './filter-types.ts';

export type { Decision, FilterStrategy } from './filter-types.ts';
export type { FilterMode } from './settings.ts';

export interface DecideOptions {
  strategy?: FilterStrategy;
  mode?: FilterMode;
  // Basis-URL des LLM-Backends; ungesetzt → Default des aktiven Providers.
  host?: string;
}

export function resolveStrategy(mode?: FilterMode, host?: string): FilterStrategy {
  const m = mode ?? loadSettings().filterMode;
  if (m === 'nimble') return createNimbleStrategy({ host });
  if (m === 'regex') return regexStrategy;
  throw new Error(`Ungültiger filterMode: "${m}". Gültige Werte: ${FILTER_MODES.join(', ')}`);
}

// Deterministische Gates vor jeder Strategie: Titel-Seniorität spart den Call komplett,
// isLehre wird für beide Modi einmal berechnet. Danach übernimmt die gewählte Strategie
// (regex oder nimble/JEV) — dieselbe Decision-Form, downstream unverändert.
export async function decide(job: Job, options: DecideOptions = {}): Promise<Decision> {
  const titleVerdict = checkTitle(job.title);
  if (titleVerdict.excluded) {
    return { status: 'filtered_out', rejectedBy: 'Seniorität (Titel)' };
  }

  const lehre = isLehre(job.title);
  const strategy = options.strategy ?? resolveStrategy(options.mode, options.host);
  return strategy.decide(job, lehre);
}
