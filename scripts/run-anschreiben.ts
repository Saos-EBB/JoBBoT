import { createStorage } from '../storage/index.ts';
import { generateAnschreiben } from '../lib/anschreiben.ts';
import { loadProfile } from '../lib/profile.ts';
import { sleep } from '../lib/fetch-page.ts';
import { createProgress } from '../lib/progress.ts';
import { config } from '../config.ts';

const profile = loadProfile();
const storage = createStorage();

// --data=save    -> nur data/jobs/sicher/   (status "matched")
// --data=unsave  -> nur data/jobs/unsicher/ (status "uncertain")
// ohne --data    -> beide Ordner, wie bisher
const dataArg = process.argv.find(a => a.startsWith('--data='));
const dataFilter = dataArg?.slice('--data='.length);
if (dataFilter && dataFilter !== 'save' && dataFilter !== 'unsave') {
  console.error(`Unbekannter --data Wert: "${dataFilter}" (erwartet: save | unsave)`);
  process.exit(1);
}

let jobs = dataFilter === 'save'
  ? await storage.list({ status: 'matched' })
  : dataFilter === 'unsave'
  ? await storage.list({ status: 'uncertain' })
  : [...await storage.list({ status: 'matched' }), ...await storage.list({ status: 'uncertain' })];

const limitArg = process.argv.find(a => a.startsWith('--limit'));
if (limitArg) {
  const limit = Number(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1]);
  if (Number.isFinite(limit) && limit > 0) jobs = jobs.slice(0, limit);
}

const sourceArg = process.argv.find(a => a.startsWith('--source='));
const model = sourceArg ? sourceArg.slice('--source='.length) : config.modelWriter;

if (jobs.length === 0) {
  console.log('Keine gematchten Jobs zum Verarbeiten.');
  process.exit(0);
}

console.log(`Modell: ${model}`);
const prog = createProgress(`Anschreiben — 0/${jobs.length}...`);
let generated = 0;

for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  prog.update(`Anschreiben — ${i + 1}/${jobs.length}: ${job.title.slice(0, 40)}`);
  const path = await generateAnschreiben(job, storage, profile, undefined, undefined, model);
  if (path) generated++;
  if (i < jobs.length - 1) await sleep(1000);
}

prog.succeed(`${generated} Anschreiben generiert, ${jobs.length - generated} übersprungen`);
