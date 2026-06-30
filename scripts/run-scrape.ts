import { karriereAtAdapter } from '../scrapers/karriere-at.ts';
import { devJobsAtAdapter } from '../scrapers/devjobs-at.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { jobId } from '../lib/hash.ts';
import { loadSources } from '../lib/sources.ts';
import { loadLocationConfig, isInRange } from '../lib/location.ts';
import type { ScraperAdapter } from '../scrapers/interface.ts';

const registry: Record<string, ScraperAdapter> = {
  'karriere.at': karriereAtAdapter,
  'devjobs.at': devJobsAtAdapter,
};

// --source=karriere → karriere.at, --source=devjobs → devjobs.at
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
  if (!src?.enabled) { console.log(`\n[${name}] deaktiviert — übersprungen`); continue; }

  console.log(`\nScraping ${name}...\n`);
  try {
    const jobs = await registry[name].scrape(src.queries);
    for (const scraped of jobs) {
      if (!isInRange(scraped.location ?? '', locCfg)) {
        console.log(`[außerhalb] ${scraped.title} — ${scraped.location}`);
        outsideTotal++;
        continue;
      }
      const id = jobId(scraped);
      if (await storage.exists(id)) {
        console.log(`[skip] ${scraped.title}`);
        skipTotal++;
      } else {
        await storage.save(toJob(scraped));
        console.log(`[new]  ${scraped.title} — ${scraped.company}`);
        newTotal++;
      }
    }
  } catch (err) {
    console.error(`[${name}] Fehler:`, err);
  }
}

console.log(`\n${newTotal} neu, ${skipTotal} übersprungen (dedup), ${outsideTotal} außerhalb Region.`);
