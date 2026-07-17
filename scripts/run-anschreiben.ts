import { appendFile } from 'node:fs/promises';
import { createStorage } from '../storage/index.ts';
import { ANSCHREIBEN_LOG_PATH } from '../lib/anschreiben.ts';
import { runAnschreiben } from '../lib/anschreiben-runner.ts';
import { loadProfile } from '../lib/profile.ts';
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

const { generated, skipped, emailsFound } = await runAnschreiben({
  jobs,
  storage,
  profile,
  model,
  onProgress: (i, total, title) => prog.update(`Anschreiben — ${i + 1}/${total}: ${title.slice(0, 40)}`),
});

prog.succeed(`${generated} Anschreiben generiert, ${skipped} übersprungen, ${emailsFound} E-Mail-Adressen gefunden`);

const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
await appendFile(ANSCHREIBEN_LOG_PATH, `\n## Anschreiben-Lauf ${ts} — Modell: ${model}${dataFilter ? `, --data=${dataFilter}` : ''}\n${generated} generiert, ${skipped} übersprungen, ${emailsFound} E-Mail-Adressen gefunden (${jobs.length} gesamt)\n`);
