import { createStorage } from '../storage/index.ts';
import { filterJob } from '../lib/filter.ts';
import { writeFilterReport } from '../lib/filter-report.ts';
import { createProgress } from '../lib/progress.ts';
import type { FilterDecision } from '../lib/filter.ts';
import { loadSettings } from '../lib/settings.ts';
import type { FilterMode } from '../lib/settings.ts';

function parseModeOverride(argv: string[]): FilterMode | undefined {
  const arg = argv.find(a => a.startsWith('--source='));
  if (!arg) return undefined;
  const value = arg.slice('--source='.length);
  if (value !== 'llama' && value !== 'regex') {
    throw new Error(`Ungültiger --source Wert: "${value}". Gültige Werte: llama, regex`);
  }
  return value;
}

const mode = parseModeOverride(process.argv.slice(2)) ?? loadSettings().filterMode;

const storage = createStorage();
const jobs = await storage.list({ status: 'new' });

if (jobs.length === 0) {
  console.log('Keine neuen Jobs zu filtern.');
  process.exit(0);
}

console.log(`Filtere ${jobs.length} Job(s)... (Modus: ${mode})\n`);

function logLine(d: FilterDecision): void {
  if (d.status === 'matched') {
    console.log(`✓ sicher   — ${d.job.title} — ${d.job.company}`);
  } else if (d.status === 'uncertain') {
    console.log(`? unsicher — ${d.job.title} — ${d.job.company}`);
    console.log(`    URL: ${d.job.url}`);
  } else {
    console.log(`✗ raus     — ${d.job.title} (Grund: ${d.rejectedBy})`);
  }
}

const decisions: FilterDecision[] = [];
let llmMs = 0;
let llmCalls = 0;
for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];

  // Regex-Modus ist offline und quasi instant — kein Spinner nötig, Zeilen-Logs reichen.
  if (mode === 'regex') {
    const d = await filterJob(job, storage, undefined, mode);
    decisions.push(d);
    logLine(d);
    continue;
  }

  const progress = createProgress(`Filter — Job ${i + 1}/${jobs.length}: ${job.title}`);
  const start = performance.now();
  const d = await filterJob(job, storage, undefined, mode);
  llmMs += performance.now() - start;
  llmCalls++;
  decisions.push(d);

  if (d.status === 'matched') {
    progress.succeed(`sicher   — ${d.job.title} — ${d.job.company}`);
  } else if (d.status === 'uncertain') {
    progress.succeed(`unsicher — ${d.job.title} — ${d.job.company}`);
    console.log(`    URL: ${d.job.url}`);
  } else {
    progress.fail(`raus     — ${d.job.title} (Grund: ${d.rejectedBy})`);
  }
}

const sicher = decisions.filter(d => d.status === 'matched').length;
const unsicher = decisions.filter(d => d.status === 'uncertain').length;
const raus = decisions.filter(d => d.status === 'filtered_out').length;
console.log(`\nFilter: ${sicher} sicher, ${unsicher} unsicher, ${raus} raus`);

if (llmCalls > 0) {
  const model = loadSettings().filterModel;
  console.log(`Ø ${model}: ${(llmMs / llmCalls).toFixed(0)}ms/Job, Gesamt ${(llmMs / 1000).toFixed(1)}s für ${llmCalls} Jobs`);
}

writeFilterReport(decisions, undefined, mode);
