import { createKarriereAtAdapter } from '../scrapers/karriere-at.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { jobId } from '../lib/hash.ts';

const keyword  = process.argv[2] ?? 'Junior Developer';
const location = process.argv[3] ?? 'Linz';

console.log(`Scraping karriere.at: "${keyword}" in "${location}"...\n`);

const adapter = createKarriereAtAdapter(keyword, location);
const storage = createStorage();
const jobs = await adapter.fetchJobs();

let newCount = 0;
let skipCount = 0;

for (const scraped of jobs) {
  const id = jobId(scraped);
  if (await storage.exists(id)) {
    console.log(`[skip] ${scraped.title}`);
    skipCount++;
  } else {
    await storage.save(toJob(scraped));
    console.log(`[new]  ${scraped.title} — ${scraped.company}`);
    newCount++;
  }
}

console.log(`\n${newCount} neue Jobs gespeichert, ${skipCount} übersprungen.`);
