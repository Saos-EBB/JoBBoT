import { appendFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createStorage } from '../storage/index.ts';
import { generateAnschreiben, ANSCHREIBEN_LOG_PATH } from '../lib/anschreiben.ts';
import { loadProfile } from '../lib/profile.ts';
import { sleep } from '../lib/fetch-page.ts';
import { createProgress } from '../lib/progress.ts';
import { config } from '../config.ts';
import { findEmail, FIRMENABC_USER_AGENT } from '../lib/find-email.ts';

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
let emailsFound = 0;

// Ein Browser für den ganzen Lauf statt pro Job — Chromium-Start ist der teure Teil,
// eine neue Seite pro Suche ist billig.
const browser = await chromium.launch({ headless: true });
const emailPage = await browser.newPage({ userAgent: FIRMENABC_USER_AGENT });

try {
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    prog.update(`Anschreiben — ${i + 1}/${jobs.length}: ${job.title.slice(0, 40)}`);
    const path = await generateAnschreiben(job, storage, profile, undefined, undefined, model);
    if (path) generated++;

    if (path && !job.email) {
      const email = await findEmail(job, emailPage).catch(() => null);
      if (email) {
        await storage.update(job.id, { email });
        emailsFound++;
      }
    }

    if (i < jobs.length - 1) await sleep(1000);
  }
} finally {
  await browser.close();
}

prog.succeed(`${generated} Anschreiben generiert, ${jobs.length - generated} übersprungen, ${emailsFound} E-Mail-Adressen gefunden`);

const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
await appendFile(ANSCHREIBEN_LOG_PATH, `\n## Anschreiben-Lauf ${ts} — Modell: ${model}${dataFilter ? `, --data=${dataFilter}` : ''}\n${generated} generiert, ${jobs.length - generated} übersprungen, ${emailsFound} E-Mail-Adressen gefunden (${jobs.length} gesamt)\n`);
