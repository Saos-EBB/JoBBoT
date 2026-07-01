import { readFileSync } from 'node:fs';

export interface ExperienceRules {
  minYears: number;
  experienceWords: string[];
  disqualifyingPhrases: string[];
  optionalMarkers: string[];
  negationMarkers: string[];
  juniorSignals: string[];
  codingKeywords: string[];
}

export interface ExpResult {
  disqualified: boolean;
  matched?: string;
}

export function loadExperienceRules(): ExperienceRules {
  const path = new URL('../config/experience-rules.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as ExperienceRules;
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some(t => text.includes(t));
}

// "N jahre" / "N+ jahre" / "N-M jahre" (untere Zahl) / "mind./ab N". Range zuerst geprüft,
// sonst matcht die einfache Regel die OBERE Zahl eines Bereichs ("3-5 Jahre" → "5 Jahre").
function extractYearThreshold(sentence: string): { n: number; text: string } | null {
  const range = sentence.match(/(\d+)\s*[-–]\s*(\d+)\s*\+?\s*(jahr\w*|years?)/i);
  if (range) return { n: Number(range[1]), text: range[0] };

  const plus = sentence.match(/(\d+)\s*\+\s*(jahr\w*|years?)/i);
  if (plus) return { n: Number(plus[1]), text: plus[0] };

  const simple = sentence.match(/(\d+)\s*(jahr\w*|years?)/i);
  if (simple) return { n: Number(simple[1]), text: simple[0] };

  const minAb = sentence.match(/(?:mind\.?|mindestens|ab)\s*(\d+)/i);
  if (minAb) return { n: Number(minAb[1]), text: minAb[0] };

  return null;
}

// Satzbasiert: Zahl/Phrase müssen im selben Satz stehen wie ein experienceWord (Zahl)
// bzw. sich selbst genügen (Phrase). optionalMarker/negationMarker im selben Satz
// entschärft den Treffer. Recall-sicher: im Zweifel NICHT disqualifizieren.
export function checkExperience(text: string, cfg: ExperienceRules): ExpResult {
  const lower = text.toLowerCase();
  const sentences = lower.split(/[.!?;\n]+/).map(s => s.trim()).filter(Boolean);

  for (const sentence of sentences) {
    const guarded = hasAny(sentence, cfg.optionalMarkers) || hasAny(sentence, cfg.negationMarkers);
    if (guarded) continue;

    const phrase = cfg.disqualifyingPhrases.find(p => sentence.includes(p));
    if (phrase) return { disqualified: true, matched: phrase };

    if (hasAny(sentence, cfg.experienceWords)) {
      const numeric = extractYearThreshold(sentence);
      if (numeric && numeric.n >= cfg.minYears) {
        return { disqualified: true, matched: numeric.text };
      }
    }
  }

  return { disqualified: false };
}
