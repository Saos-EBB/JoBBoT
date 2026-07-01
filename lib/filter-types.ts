import type { Job } from '../scrapers/interface.ts';
import type { FilterJudgment } from './filter-llm.ts';

export interface Decision {
  status: 'matched' | 'uncertain' | 'filtered_out';
  rejectedBy?: string;
  judgment?: FilterJudgment;
}

// Beide Modi (llm, regex) implementieren dasselbe Interface — decide() (Orchestrator)
// ruft die gewählte Strategie NACH den gemeinsamen deterministischen Gates auf.
export interface FilterStrategy {
  name: string;
  decide(job: Job, isLehre: boolean): Promise<Decision>;
}
