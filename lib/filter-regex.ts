import { buildStageInput } from './job-text.ts';
import { checkExperience, loadExperienceRules } from './experience-regex.ts';
import type { ExperienceRules } from './experience-regex.ts';
import type { FilterStrategy } from './filter-types.ts';

function hasAny(text: string, terms: string[]): boolean {
  return terms.some(t => text.includes(t));
}

// Deterministisch, offline (kein Ollama). Titel-Seniorität + isLehre laufen bereits
// gemeinsam vor der Strategie (siehe filter-decide.ts). Regex kann eine IT-Rolle nicht
// sauber erkennen → im Regex-Modus KEINE IT-Rolle-Ablehnung; neutrale/Non-Dev-Rollen
// landen bewusst in "uncertain", der Mensch culled (grober als der llm-Modus).
export function createRegexStrategy(cfg: ExperienceRules = loadExperienceRules()): FilterStrategy {
  return {
    name: 'regex',
    async decide(job, lehre) {
      const input = buildStageInput(job);
      const lower = input.toLowerCase();

      const exp = checkExperience(input, cfg);
      if (exp.disqualified) {
        return { status: 'filtered_out', rejectedBy: `Erfahrung ≥${cfg.minYears}J: '${exp.matched}'` };
      }

      if (lehre && !hasAny(lower, cfg.codingKeywords)) {
        return { status: 'filtered_out', rejectedBy: 'Lehre nicht coding-nah' };
      }

      if (hasAny(lower, cfg.juniorSignals)) {
        return { status: 'matched' };
      }
      return { status: 'uncertain' };
    },
  };
}

export const regexStrategy = createRegexStrategy();
