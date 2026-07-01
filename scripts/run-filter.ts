import { createStorage } from '../storage/index.ts';
import { filterJob } from '../lib/filter.ts';
import { writeFilterReport } from '../lib/filter-report.ts';
import { createProgress } from '../lib/progress.ts';
import type { FilterDecision } from '../lib/filter.ts';

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
  const progress = createProgress(`Filter — Job ${i + 1}/${jobs.length}: ${job.title}`);
  const d = await filterJob(job, storage);
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

writeFilterReport(decisions);
