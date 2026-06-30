import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FilterDecision } from './filter.ts';

export function writeFilterReport(decisions: FilterDecision[], path = 'data/filter-log.md'): void {
  const matched = decisions.filter(d => d.outcome === 'matched');
  const filtered = decisions.filter(d => d.outcome === 'filtered_out');
  const skipped = decisions.filter(d => d.outcome === 'skipped');

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines: string[] = [
    `\n## Filter-Lauf ${ts}  (matched: ${matched.length}, aussortiert: ${filtered.length}, skipped: ${skipped.length})\n`,
  ];

  if (filtered.length) {
    lines.push('\n### Aussortiert\n');
    for (const d of filtered) {
      const snippet = (d.job.description ?? '').slice(0, 150).replace(/\n/g, ' ');
      lines.push(`- **${d.job.title}** — ${d.job.company} — ${d.job.location ?? ''}`);
      lines.push(`  - Grund: ${d.reason}`);
      lines.push(`  - URL: ${d.job.url}`);
      if (snippet) lines.push(`  - Snippet: ${snippet}`);
    }
  }

  if (matched.length) {
    lines.push('\n### Behalten\n');
    for (const d of matched) {
      lines.push(`- ${d.job.title} — ${d.job.company} — ${d.job.location ?? ''}`);
    }
  }

  if (skipped.length) {
    lines.push('\n### Skipped\n');
    for (const d of skipped) {
      lines.push(`- ${d.job.title} — ${d.job.company}  (Grund: ${d.reason})`);
    }
  }

  lines.push('\n---\n');

  mkdirSync(dirname(path) || '.', { recursive: true });
  appendFileSync(path, lines.join('\n'));
}
