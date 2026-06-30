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

  if (d.outcome === 'matched') {
    console.log(green(`✓ matched      — ${d.job.title} — ${d.job.company}`));
  } else if (d.outcome === 'filtered_out') {
    console.log(red(`✗ filtered_out — ${d.job.title} — ${d.job.company} (${d.job.location ?? ''})`));
    console.log(`    Grund: ${d.reason}`);
    console.log(`    URL:   ${d.job.url}`);
  } else {
    console.log(yellow(`… skipped      — ${d.job.title} (${d.reason})`));
  }

  if (i < jobs.length - 1) await sleep(500);
}

const matched  = decisions.filter(d => d.outcome === 'matched').length;
const filtered = decisions.filter(d => d.outcome === 'filtered_out').length;
const skipped  = decisions.filter(d => d.outcome === 'skipped').length;
console.log(`\nFilter fertig: ${matched} matched, ${filtered} aussortiert, ${skipped} skipped`);

writeFilterReport(decisions);
