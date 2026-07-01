// Nur Seniorität hart ausschließen. Lehre/Lehrling und 1st/2nd-Level entscheidet
// der LLM aus der Beschreibung — eine Titel-Keyword-Regel kann "coding-nahe Lehre"
// vs. "Lehre Systemtechnik" bzw. "1st Level" vs. "1st & 2nd Level" nicht sauber trennen.
const HARD_EXCLUDE = ['senior', 'lead', 'principal', 'architekt'];

export interface TitleVerdict {
  excluded: boolean;
  term?: string;
}

// token.includes(term) statt exaktem Vergleich, damit deutsche Komposita greifen
// ("softwarearchitekt" enthält "architekt", "lehrlingsstelle" enthält "lehrling").
export function checkTitle(title: string): TitleVerdict {
  const tokens = title.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
  for (const token of tokens) {
    const term = HARD_EXCLUDE.find(t => token.includes(t));
    if (term) return { excluded: true, term };
  }
  return { excluded: false };
}

const LEHRE_TERMS = ['lehre', 'lehrling', 'ausbildung'];

export function isLehre(title: string): boolean {
  const tokens = title.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
  return tokens.some(token => LEHRE_TERMS.some(t => token.includes(t)));
}
