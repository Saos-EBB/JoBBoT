import { createKarriereAtAdapter } from '../scrapers/karriere-at.ts';
import { devJobsAtAdapter } from '../scrapers/devjobs-at.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { jobId } from '../lib/hash.ts';
import type { ScraperAdapter } from '../scrapers/interface.ts';

const keyword  = process.argv[2] ?? 'Junior Developer';
const location = process.argv[3] ?? 'Linz';

const adapters: ScraperAdapter[] = [
  createKarriereAtAdapter(keyword, location),
  devJobsAtAdapter,
];

const storage = createStorage();
let newTotal = 0;
let skipTotal = 0;

for (const adapter of adapters) {
  console.log(`\nScraping ${adapter.name}...\n`);
  try {
    const jobs = await adapter.fetchJobs();
    for (const scraped of jobs) {
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
    console.error(`[${adapter.name}] Fehler:`, err);
  }
}

console.log(`\n${newTotal} neue Jobs gespeichert, ${skipTotal} übersprungen.`);
