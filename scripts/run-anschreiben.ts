import { createStorage } from '../storage/index.ts';
import { generateAnschreiben } from '../lib/anschreiben.ts';
import { sleep } from '../lib/fetch-page.ts';

const storage = createStorage();
const jobs = await storage.list({ status: 'matched' });

if (jobs.length === 0) {
  console.log('Keine gematchten Jobs zum Verarbeiten.');
  process.exit(0);
}

console.log(`Generiere Anschreiben für ${jobs.length} Job(s)...\n`);

let generated = 0;

for (const job of jobs) {
  await generateAnschreiben(job, storage);
  if (job.status === 'generated') {
    console.log(`[generated] ${job.title} — ${job.company}`);
    generated++;
  } else {
    console.log(`[fehler]    ${job.title}`);
  }
  if (jobs.indexOf(job) < jobs.length - 1) await sleep(1000);
}

console.log(`\n${generated} Anschreiben generiert.`);
