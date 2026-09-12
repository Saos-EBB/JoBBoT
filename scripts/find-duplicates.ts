import { JsonStore } from '../storage/json-store.ts';
import { findDuplicates } from '../lib/duplicates.ts';

const storage = new JsonStore();
const jobs = await storage.list();
const groups = findDuplicates(jobs);

if (groups.length === 0) {
  console.log(`Keine Duplikate unter ${jobs.length} Job(s).`);
  process.exit(0);
}

console.log(`${groups.length} Duplikat-Gruppe(n) unter ${jobs.length} Job(s):\n`);
for (const g of groups) {
  console.log(`— ${g.jobs[0].title} — ${g.jobs[0].company} (${g.jobs.length}×)`);
  for (const job of g.jobs) {
    console.log(`    ${job.scrapedAt.slice(0, 10)}  ${job.status}  ${job.id}  ${job.url}`);
  }
}
console.log('\nNur Report — nichts wurde gelöscht.');
