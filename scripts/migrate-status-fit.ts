import { createStorage } from '../storage/index.ts';
import type { Job, JobStatus } from '../scrapers/interface.ts';

// Nur die UI-Zone wird umbenannt (bisher exklusiv von scripts/ui-server.ts geschrieben,
// komplett ersetzt). Pipeline-Zone (new/filtered_out/uncertain/matched/generated) bleibt
// unangetastet — lib/filter-decide.ts und lib/anschreiben.ts schreiben weiter die alten Werte.
const STATUS_RENAME: Partial<Record<string, JobStatus>> = {
  reviewed: 'freigegeben',
  drafted: 'postausgang',
  sent: 'gesendet',
};

const storage = createStorage();
const jobs = await storage.list();

let statusChanged = 0;
let fitBackfilled = 0;

for (const job of jobs) {
  const raw = job as Job & { fit?: unknown };
  const patch: Partial<Job> = {};

  const renamed = STATUS_RENAME[job.status as string];
  if (renamed) {
    patch.status = renamed;
    statusChanged++;
  }
  if (raw.fit === undefined) {
    patch.fit = null;
    fitBackfilled++;
  }

  if (Object.keys(patch).length > 0) {
    await storage.update(job.id, patch);
  }
}

console.log(`${statusChanged} Status umbenannt, ${fitBackfilled}× fit nachgetragen (${jobs.length} Jobs gesamt).`);
