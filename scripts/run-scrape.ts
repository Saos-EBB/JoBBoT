import { karriereAtAdapter } from '../scrapers/karriere-at.ts';
import { devJobsAtAdapter } from '../scrapers/devjobs-at.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { jobId } from '../lib/hash.ts';
import { loadSources } from '../lib/sources.ts';
import { loadLocationConfig, isInRange } from '../lib/location.ts';
import { createProgress } from '../lib/progress.ts';
import type { ScraperAdapter } from '../scrapers/interface.ts';

const registry: Record<string, ScraperAdapter> = {
  'karriere.at': karriereAtAdapter,
  'devjobs.at': devJobsAtAdapter,
};

const sourceArg = process.argv.find(a => a.startsWith('--source='))?.split('=')[1];
const ALIASES: Record<string, string> = { karriere: 'karriere.at', devjobs: 'devjobs.at' };

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
const storage = createStorage();
let newTotal = 0, skipTotal = 0, outsideTotal = 0;

for (const name of selectedKeys) {
  const src = sources[name];
  if (!src?.enabled) { console.log(`[${name}] deaktiviert — übersprungen`); continue; }

  const prog = createProgress(`${name} — starte...`);
  let newSrc = 0, skipSrc = 0, outsideSrc = 0;
  try {
    const jobs = await registry[name].scrape(src.queries, msg => prog.update(msg));
    for (const scraped of jobs) {
      if (!isInRange(scraped.location ?? '', locCfg)) { outsideSrc++; continue; }
      const id = jobId(scraped);
      if (await storage.exists(id)) { skipSrc++; }
      else { await storage.save(toJob(scraped)); newSrc++; }
    }
    prog.succeed(`${name}: ${newSrc} neu, ${skipSrc} dedup, ${outsideSrc} außerhalb`);
  } catch (err) {
    prog.fail(`${name}: Fehler — ${err}`);
  }
  newTotal += newSrc; skipTotal += skipSrc; outsideTotal += outsideSrc;
}

console.log(`\nGesamt: ${newTotal} neu, ${skipTotal} dedup, ${outsideTotal} außerhalb Region.`);
