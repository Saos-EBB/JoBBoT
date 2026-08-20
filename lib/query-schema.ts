import type { QueryField, ScraperAdapter, SourceQuery } from '../scrapers/interface.ts';

export type QueryProblem =
  | { kind: 'missing'; key: string }
  | { kind: 'unknown'; key: string; expected: string[] };

// Prüft eine einzelne Anfrage gegen das Schema ihres Portals. Leeres Ergebnis = in Ordnung.
export function checkQuery(schema: QueryField[], query: SourceQuery): QueryProblem[] {
  const known = schema.map(f => f.key);
  const problems: QueryProblem[] = [];
  for (const field of schema) {
    if (field.required && !query[field.key]?.trim()) problems.push({ kind: 'missing', key: field.key });
  }
  for (const key of Object.keys(query)) {
    if (!known.includes(key)) problems.push({ kind: 'unknown', key, expected: known });
  }
  return problems;
}

export function describeProblem(p: QueryProblem): string {
  return p.kind === 'missing'
    ? `Pflichtfeld "${p.key}" fehlt`
    : `unbekannter Schlüssel "${p.key}" — erwartet: ${p.expected.join(', ')}`;
}

// Der Ersatz für das stille `if (!keyword) continue;`, das bisher in jedem Adapter stand:
// eine fehlerhafte Anfrage fällt weiterhin raus, sagt aber Bescheid. Der Lauf bricht
// nicht ab — ein Tippfehler in einer von zwanzig Anfragen soll nicht den ganzen Scrape
// kosten (siehe .scratch/einstellungsseite, Ticket "Schema pro Portal").
//
// warn ist injizierbar, damit Tests die Ausgabe prüfen können, ohne console zu kapern.
export function usableQueries(
  adapter: Pick<ScraperAdapter, 'name' | 'querySchema'>,
  queries: SourceQuery[],
  warn: (msg: string) => void = console.warn,
): SourceQuery[] {
  return queries.filter((query, i) => {
    const problems = checkQuery(adapter.querySchema, query);
    if (problems.length === 0) return true;
    warn(`[${adapter.name}] Anfrage ${i + 1} übersprungen — ${problems.map(describeProblem).join('; ')}`);
    return false;
  });
}
