const HARD_EXCLUDE = [
  'senior', 'lead', 'principal', 'architekt',
  'lehre', 'lehrling', 'ausbildung',
];

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
