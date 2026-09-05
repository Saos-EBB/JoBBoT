import { createStorage } from '../storage/index.ts';
import { runFilter } from '../lib/filter-runner.ts';
import type { FilterScope } from '../lib/filter-runner.ts';
import { createProgress } from '../lib/progress.ts';
import type { Progress } from '../lib/progress.ts';
import type { FilterDecision } from '../lib/filter.ts';
import { loadSettings } from '../lib/settings.ts';
import type { FilterMode } from '../lib/settings.ts';

function parseModeOverride(argv: string[]): FilterMode | undefined {
  const arg = argv.find(a => a.startsWith('--source='));
  if (!arg) return undefined;
  const value = arg.slice('--source='.length);
  if (value !== 'llm' && value !== 'regex') {
    throw new Error(`Ungültiger --source Wert: "${value}". Gültige Werte: llm, regex`);
  }
  return value;
}

function parseScope(argv: string[]): FilterScope {
  const arg = argv.find(a => a.startsWith('--scope='));
  if (!arg) return 'new';
  const value = arg.slice('--scope='.length);
  if (value !== 'new' && value !== 'all') {
    throw new Error(`Ungültiger --scope Wert: "${value}". Gültige Werte: new, all`);
  }
  return value;
}

const mode = parseModeOverride(process.argv.slice(2)) ?? loadSettings().filterMode;
const scope = parseScope(process.argv.slice(2));
const storage = createStorage();

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

// Der Spinner gehört dem Terminal, nicht dem Lauf — deshalb hängt er hier an den
// Callbacks und nicht im Runner (die UI setzt an derselben Stelle ihr Lade-Grid).
let progress: Progress | null = null;
let start = 0;
let llmMs = 0;
let llmCalls = 0;

// Die Kopfzeile braucht die Gesamtzahl, und die kennt erst der Runner (er liest die
// Liste). Deshalb beim ersten Fortschritt statt vor dem Aufruf.
const outcome = await runFilter({
  storage,
  scope,
  mode,
  onProgress: (i, total, job) => {
    if (i === 0) console.log(`Filtere ${total} Job(s)... (Modus: ${mode}, Scope: ${scope})\n`);
    // Regex-Modus ist offline und quasi instant — kein Spinner nötig, Zeilen-Logs reichen.
    if (mode !== 'regex') {
      progress = createProgress(`Filter — Job ${i + 1}/${total}: ${job.title}`);
      start = performance.now();
    }
  },
  onDecision: d => {
    const laufend = progress;
    if (!laufend) { logLine(d); return; }
    llmMs += performance.now() - start;
    llmCalls++;
    progress = null;
    if (d.status === 'matched') {
      laufend.succeed(`sicher   — ${d.job.title} — ${d.job.company}`);
    } else if (d.status === 'uncertain') {
      laufend.succeed(`unsicher — ${d.job.title} — ${d.job.company}`);
      console.log(`    URL: ${d.job.url}`);
    } else {
      laufend.fail(`raus     — ${d.job.title} (Grund: ${d.rejectedBy})`);
    }
  },
});

if (outcome.decisions.length === 0) {
  console.log(scope === 'all' ? 'Keine Jobs vorhanden.' : 'Keine neuen Jobs zu filtern.');
  process.exit(0);
}

console.log(`\nFilter: ${outcome.matched} sicher, ${outcome.offstack} unsicher, ${outcome.brutal} raus`);

if (llmCalls > 0) {
  const model = loadSettings().filterModel;
  console.log(`Ø ${model}: ${(llmMs / llmCalls).toFixed(0)}ms/Job, Gesamt ${(llmMs / 1000).toFixed(1)}s für ${llmCalls} Jobs`);
}
