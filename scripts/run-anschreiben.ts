import { createStorage } from '../storage/index.ts';
import { generateAnschreiben } from '../lib/anschreiben.ts';
import { loadProfile } from '../lib/profile.ts';
import { sleep } from '../lib/fetch-page.ts';
import { createProgress } from '../lib/progress.ts';

const profile = loadProfile();
const storage = createStorage();
const jobs = [...await storage.list({ status: 'matched' }), ...await storage.list({ status: 'uncertain' })];

if (jobs.length === 0) {
  console.log('Keine gematchten Jobs zum Verarbeiten.');
  process.exit(0);
}

const prog = createProgress(`Anschreiben — 0/${jobs.length}...`);
let generated = 0;

for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  prog.update(`Anschreiben — ${i + 1}/${jobs.length}: ${job.title.slice(0, 40)}`);
  const path = await generateAnschreiben(job, storage, profile);
  if (path) generated++;
  if (i < jobs.length - 1) await sleep(1000);
}

prog.succeed(`${generated} Anschreiben generiert, ${jobs.length - generated} übersprungen`);
