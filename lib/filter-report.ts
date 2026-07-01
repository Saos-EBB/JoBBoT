import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FilterDecision } from './filter.ts';

function unsureStages(d: FilterDecision): string {
  return d.stages.filter(s => s.outcome === 'unsure').map(s => s.stage).join(', ');
}

export function writeFilterReport(decisions: FilterDecision[], path = 'data/filter-log.md'): void {
  const raus = decisions.filter(d => d.status === 'filtered_out');
  const unsicher = decisions.filter(d => d.status === 'uncertain');
  const sicher = decisions.filter(d => d.status === 'matched');

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines: string[] = [
    `\n## Filter-Lauf ${ts}  (${sicher.length} sicher, ${unsicher.length} unsicher, ${raus.length} raus)\n`,
  ];

  lines.push(`\n### Raus (${raus.length})\n`);
  for (const d of raus) {
    lines.push(`- ${d.job.title} — ${d.job.company} — rausgeflogen an: ${d.rejectedBy ?? '?'}`);
  }

  lines.push(`\n### Unsicher (${unsicher.length})\n`);
  for (const d of unsicher) {
    lines.push(`- ${d.job.title} — ${d.job.company} — unsicher an: ${unsureStages(d)}`);
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
