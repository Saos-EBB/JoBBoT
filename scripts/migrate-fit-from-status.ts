import { createStorage } from '../storage/index.ts';
import type { Job } from '../scrapers/interface.ts';

// One-off Backfill: status/fit sind jetzt 1:1 gekoppelt (siehe lib/filter.ts,
// STATUS_FIT) — matched→match, uncertain→offstack, filtered_out→brutal. Jobs,
// die vor dieser Kopplung gefiltert wurden, haben noch fit=null. Überschreibt
// NICHT bereits manuell gesetzte fit-Werte.
const STATUS_FIT: Partial<Record<Job['status'], Job['fit']>> = {
  matched: 'match',
  uncertain: 'offstack',
  filtered_out: 'brutal',
};

const storage = createStorage();
const jobs = await storage.list();

let backfilled = 0;
for (const job of jobs) {
  if (job.fit != null) continue;
  const fit = STATUS_FIT[job.status];
  if (!fit) continue;
  await storage.update(job.id, { fit });
  backfilled++;
}

console.log(`${backfilled}× fit nachgetragen (${jobs.length} Jobs gesamt).`);
