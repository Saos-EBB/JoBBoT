import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FilterDecision } from './filter.ts';
import type { FilterJudgment } from './filter-llm.ts';

const KRITERIEN = ['it_rolle', 'erfahrung_ab_3j_erforderlich', 'lehre_coding', 'junior_signal'] as const;

function unsureNote(d: FilterDecision): string {
  if (!d.judgment) return 'kein JSON-Urteil (Parse-Fehler)';
  const j = d.judgment;
  const unsure = KRITERIEN.filter(k => j[k] === 'unsicher');
  if (unsure.length > 0) return unsure.join(', ');
  return 'kein junior_signal';
}

// Aggregat pro Kriterium, damit sichtbar bleibt, wie oft das 7b-Modell "unsicher"
// sagt — Kalibrierungssignal für die Prompt-Formulierung.
function aggregate(decisions: FilterDecision[]): string {
  return KRITERIEN.map(key => {
    const counts: Record<string, number> = {};
    for (const d of decisions) {
      if (!d.judgment) continue;
      const v = d.judgment[key];
      counts[v] = (counts[v] ?? 0) + 1;
    }
    const parts = Object.entries(counts).map(([v, n]) => `${v}:${n}`).join(' ');
    return `- ${key} → ${parts || '–'}`;
  }).join('\n');
}

export function writeFilterReport(decisions: FilterDecision[], path = 'data/filter-log.md'): void {
  const raus = decisions.filter(d => d.status === 'filtered_out');
  const unsicher = decisions.filter(d => d.status === 'uncertain');
  const sicher = decisions.filter(d => d.status === 'matched');

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines: string[] = [
    `\n## Filter-Lauf ${ts}  (${sicher.length} sicher, ${unsicher.length} unsicher, ${raus.length} raus)\n`,
    '\n### Aggregat (Kriterien-Verteilung)\n',
    aggregate(decisions),
  ];

  lines.push(`\n### Raus (${raus.length})\n`);
  for (const d of raus) {
    lines.push(`- ${d.job.title} — ${d.job.company} — Grund: ${d.rejectedBy ?? '?'}`);
  }

  lines.push(`\n### Unsicher (${unsicher.length})\n`);
  for (const d of unsicher) {
    lines.push(`- ${d.job.title} — ${d.job.company} — ${unsureNote(d)}`);
    lines.push(`  - URL: ${d.job.url}`);
  }

  lines.push(`\n### Sicher (${sicher.length})\n`);
  for (const d of sicher) {
    lines.push(`- ${d.job.title} — ${d.job.company}`);
  }

  lines.push('\n---\n');

  mkdirSync(dirname(path) || '.', { recursive: true });
  appendFileSync(path, lines.join('\n'));
}
