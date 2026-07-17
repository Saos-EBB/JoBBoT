import { appendFile } from 'node:fs/promises';
import { createStorage } from '../storage/index.ts';
import { ANSCHREIBEN_LOG_PATH } from '../lib/anschreiben.ts';
import { runAnschreiben } from '../lib/anschreiben-runner.ts';
import { loadProfile } from '../lib/profile.ts';
import { createProgress } from '../lib/progress.ts';
import { config } from '../config.ts';

const profile = loadProfile();
const storage = createStorage();

// --data=save    -> nur data/jobs/sicher/   (fit "matched")
// --data=unsave  -> nur data/jobs/unsicher/ (fit "offstack")
// ohne --data    -> beide, wie bisher
const dataArg = process.argv.find(a => a.startsWith('--data='));
const dataFilter = dataArg?.slice('--data='.length);
if (dataFilter && dataFilter !== 'save' && dataFilter !== 'unsave') {
  console.error(`Unbekannter --data Wert: "${dataFilter}" (erwartet: save | unsave)`);
  process.exit(1);
}

const triaged = await storage.list({ status: 'triaged' });
let jobs = dataFilter === 'save'
  ? triaged.filter(j => j.fit === 'matched')
  : dataFilter === 'unsave'
  ? triaged.filter(j => j.fit === 'offstack')
  : triaged.filter(j => j.fit !== 'brutal');

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
