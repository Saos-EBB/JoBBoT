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

export interface MergePlan {
  keep: Job;
  scrapedAt: string;
  remove: Job[];
}

// Das neueste Inserat der Gruppe ersetzt die älteren (frischerer Titel/Beschreibung/
// Status) — übernimmt aber deren scrapedAt (group.jobs ist aufsteigend sortiert,
// also jobs[0]), damit das ursprüngliche Erst-Pull-Datum nicht beim Merge verloren geht.
//
// Arbeitet mit den vollen Job-Objekten (Objektidentität), nicht mit job.id: ein
// echter Re-Scrape derselben Stelle trägt in beiden Dateien dieselbe id (nur der
// Dateiname unterscheidet sich durchs Datum) — ein Vergleich über j.id würde dann
// fälschlich BEIDE als "neuestes" erkennen bzw. gar keins zum Löschen übriglassen.
export function planMerge(group: DuplicateGroup): MergePlan {
  const oldest = group.jobs[0];
  const newest = group.jobs[group.jobs.length - 1];
  return {
    keep: newest,
    scrapedAt: oldest.scrapedAt,
    remove: group.jobs.filter(j => j !== newest),
  };
}
