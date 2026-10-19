import type { Decision } from './filter-types.ts';

// Das Urteil einer LLM-Filterstrategie (heute nur JEV/Nimble, lib/filter-nimble.ts) in
// vier Kriterien und dessen Abbildung auf matched/uncertain/filtered_out. Stand bis
// Oktober 2026 in lib/filter-llm.ts, zusammen mit dem inzwischen entfernten
// Gemma-JSON-Filter (filterMode "llm").

export type Tri = 'ja' | 'nein' | 'unsicher';

export interface FilterJudgment {
  it_rolle: Tri;
  erfahrung_ab_3j_erforderlich: Tri;
  lehre_coding: Tri | 'n/a';
  junior_signal: 'ja' | 'nein';
}

function hasUnsicher(j: FilterJudgment): boolean {
  return j.it_rolle === 'unsicher' || j.erfahrung_ab_3j_erforderlich === 'unsicher' || j.lehre_coding === 'unsicher';
}

// Kriterien → Decision-Mapping.
// "unsicher" bzw. ein Parse-Fehler (judgment === null) zählt NIE als Reject — recall-sicher.
export function mapJudgment(judgment: FilterJudgment | null, lehre: boolean): Decision {
  if (!judgment) return { status: 'uncertain' };

  if (judgment.it_rolle === 'nein') return { status: 'filtered_out', rejectedBy: 'IT-Rolle', judgment };
  if (judgment.erfahrung_ab_3j_erforderlich === 'ja') return { status: 'filtered_out', rejectedBy: 'Erfahrung ≥3J', judgment };
  if (lehre && judgment.lehre_coding === 'nein') return { status: 'filtered_out', rejectedBy: 'Lehre nicht coding', judgment };

  if (judgment.junior_signal === 'ja' && !hasUnsicher(judgment)) {
    return { status: 'matched', judgment };
  }
  return { status: 'uncertain', judgment };
}
