import { createStorage } from '../storage/index.ts';
import { filterJob } from '../lib/filter.ts';
import { writeFilterReport } from '../lib/filter-report.ts';
import { sleep } from '../lib/fetch-page.ts';
import type { FilterDecision } from '../lib/filter.ts';

const isTTY = process.stdout.isTTY;
const green  = (s: string) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red    = (s: string) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const yellow = (s: string) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;

const storage = createStorage();
const jobs = await storage.list({ status: 'new' });

if (jobs.length === 0) {
  console.log('Keine neuen Jobs zu filtern.');
  process.exit(0);
}

console.log(`Filtere ${jobs.length} Job(s)...\n`);

const decisions: FilterDecision[] = [];
for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  const d = await filterJob(job, storage);
  decisions.push(d);

  if (d.status === 'matched') {
    console.log(green(`✓ sicher   — ${d.job.title} — ${d.job.company}`));
  } else if (d.status === 'uncertain') {
    const stufen = d.stages.filter(s => s.outcome === 'unsure').map(s => s.stage).join(', ');
    console.log(yellow(`? unsicher — ${d.job.title} — ${d.job.company} (Stufe: ${stufen})`));
    console.log(`    URL: ${d.job.url}`);
  } else {
    console.log(red(`✗ raus     — ${d.job.title} (Stufe: ${d.rejectedBy})`));
  }

  // Titel-Regel (Stufe 1) macht keinen Ollama-Call, keine Pause nötig
  if (i < jobs.length - 1 && d.stages.length > 1) await sleep(500);
}

const sicher = decisions.filter(d => d.status === 'matched').length;
const unsicher = decisions.filter(d => d.status === 'uncertain').length;
const raus = decisions.filter(d => d.status === 'filtered_out').length;
console.log(`\nFilter: ${sicher} sicher, ${unsicher} unsicher, ${raus} raus`);

writeFilterReport(decisions);
