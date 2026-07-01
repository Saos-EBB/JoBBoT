import { karriereAtAdapter } from '../scrapers/karriere-at.ts';
import { devJobsAtAdapter } from '../scrapers/devjobs-at.ts';
import { linkedinAdapter } from '../scrapers/linkedin.ts';
import { amsAdapter } from '../scrapers/ams.ts';
import { jobsAtAdapter } from '../scrapers/jobs-at.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { jobId } from '../lib/hash.ts';
import { loadSources } from '../lib/sources.ts';
import { loadLocationConfig, isInRange } from '../lib/location.ts';
import { createAggregateProgress } from '../lib/progress.ts';
import type { ScraperAdapter, ScrapedJob } from '../scrapers/interface.ts';

const registry: Record<string, ScraperAdapter> = {
  'karriere.at': karriereAtAdapter,
  'devjobs.at': devJobsAtAdapter,
  'linkedin': linkedinAdapter,
  'ams': amsAdapter,
  'jobs.at': jobsAtAdapter,
};

const sourceArg = process.argv.find(a => a.startsWith('--source='))?.split('=')[1];
const ALIASES: Record<string, string> = { karriere: 'karriere.at', devjobs: 'devjobs.at', linkedin: 'linkedin', ams: 'ams', jobs: 'jobs.at' };

let selectedKeys: string[];
if (sourceArg) {
  const key = ALIASES[sourceArg] ?? sourceArg;
  if (!registry[key]) {
    console.error(`Unbekannte Quelle: "${sourceArg}". Gültig: ${Object.keys(ALIASES).join(', ')}`);
    process.exit(1);
  }
  selectedKeys = [key];
} else {
  selectedKeys = Object.keys(registry);
}

const sources = loadSources();
const locCfg = loadLocationConfig();
const keep = (job: ScrapedJob) => isInRange(job.location ?? '', locCfg);
const storage = createStorage();

const activeNames = selectedKeys.filter(name => {
  if (!sources[name]?.enabled) { console.log(`[${name}] deaktiviert — übersprungen`); return false; }
  return true;
});

if (activeNames.length === 0) {
  console.log('Keine aktive Quelle.');
  process.exit(0);
}

// STEP 1: alle Quellen parallel, allSettled statt Promise.all — eine gescheiterte
// Quelle darf die anderen nicht abbrechen. Die 2s-Höflichkeitspausen + sequenziellen
// Detail-Fetches INNERHALB jedes Adapters bleiben unverändert.
const prog = createAggregateProgress(activeNames);
const settled = await Promise.allSettled(
  activeNames.map(name => registry[name].scrape(
    sources[name].queries,
    keep,
    (current, total) => prog.report(name, current, total),
  )),
);
prog.stop();

// STEP 2: erst NACH allSettled sequenziell dedup + save — verhindert Write-Races,
// wenn dieselbe Stelle über zwei Quellen reinkommt (gleiche jobId).
let newTotal = 0, skipTotal = 0;
for (let i = 0; i < activeNames.length; i++) {
  const name = activeNames[i];
  const result = settled[i];

  if (result.status === 'rejected') {
    console.log(`✗ ${name}: Fehler — ${result.reason}`);
    continue;
  }

  let newSrc = 0, skipSrc = 0;
  for (const scraped of result.value) {
    const id = jobId(scraped);
    if (await storage.exists(id)) { skipSrc++; }
    else { await storage.save(toJob(scraped)); newSrc++; }
  }
  console.log(`✓ ${name}: ${newSrc} neu, ${skipSrc} dedup`);
  newTotal += newSrc; skipTotal += skipSrc;
}

console.log(`\nGesamt: ${newTotal} neu, ${skipTotal} dedup.`);
