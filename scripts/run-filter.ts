import { createStorage } from '../storage/index.ts';
import { filterJob } from '../lib/filter.ts';
import { sleep } from '../lib/fetch-page.ts';

const storage = createStorage();
const jobs = await storage.list({ status: 'new' });

if (jobs.length === 0) {
  console.log('Keine neuen Jobs zu filtern.');
  process.exit(0);
}

console.log(`Filtere ${jobs.length} Job(s)...\n`);

for (const job of jobs) {
  await filterJob(job, storage);
  if (job.status === 'filtered_out') {
    await storage.delete(job.id);
    console.log(`[gelöscht] ${job.title} — ${job.company} (filtered_out)`);
  } else {
    const label = job.status === 'matched' ? '[matched]' : '[skipped]';
    const reason = job.match?.reason ?? '';
    console.log(`${label} ${job.title} @ ${job.company}${reason ? ` — ${reason}` : ''}`);
  }
  if (jobs.indexOf(job) < jobs.length - 1) await sleep(500);
}
