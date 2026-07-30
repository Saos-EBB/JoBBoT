import type { Job } from '../scrapers/interface.ts';
import { jobId } from './hash.ts';

export interface DuplicateGroup {
  key: string;
  jobs: Job[];
}

// Gruppiert nach frisch berechneter jobId() statt nach dem gespeicherten job.id —
// Jobs, die VOR einer Normalisierungs-Änderung in hash.ts gescraped wurden, tragen
// noch die alte id und würden sonst nicht als Duplikat ihres neueren Gegenstücks
// erkannt. Reine Leseoperation: löscht/ändert nichts, siehe scripts/find-duplicates.ts.
export function findDuplicates(jobs: Job[]): DuplicateGroup[] {
  const byKey = new Map<string, Job[]>();
  for (const job of jobs) {
    const key = jobId(job);
    const group = byKey.get(key);
    if (group) group.push(job);
    else byKey.set(key, [job]);
  }
  return [...byKey.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      jobs: group.sort((a, b) => a.scrapedAt.localeCompare(b.scrapedAt)),
    }));
}
