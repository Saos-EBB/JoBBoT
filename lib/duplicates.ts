import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/json-store.ts';
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
    // Ohne Firma (oder ohne Titel) trägt der Schlüssel zu wenig, um einen Merge zu
    // rechtfertigen: jobs.at liefert für einen Teil der Inserate keine Firma, und
    // zwei verschiedene "Software-Entwickler (m/w/d)" ohne Firma würden sonst zu
    // einem verschmolzen — ein Merge löscht Dateien, ein verpasstes Duplikat nicht.
    if (!job.company.trim() || !job.title.trim()) continue;
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

// Das Anschreiben lebt nicht im Job-JSON, sondern als eigene .md-Datei — find/carry
// sind deshalb injiziert (die Datei-/Slug-Details bleiben beim Aufrufer), damit der
// Merge-Ablauf mit einem Fake-Storage testbar ist statt inline im Route-Handler zu
// stecken, wo ihn kein Test erreicht.
export interface MergeBriefOps {
  find: (job: Job) => Promise<string | null>;
  carry: (from: string, to: Job) => Promise<void>;
}

// Führt die Merge-Pläne aus (planMerge pro Gruppe): Zwillinge löschen, und falls der
// behaltene Job noch keinen Brief hat, den des JÜNGSTEN entfernten Zwillings mit Brief
// übernehmen (plan.remove ist nach scrapedAt aufsteigend, deshalb rückwärts). Danach
// den behaltenen Job exakt löschen und unter dem übernommenen scrapedAt neu speichern —
// nicht per update(), das den Dateinamen aus dem gepatchten scrapedAt neu ableitete und
// die alte Datei als Leiche liegenließe.
export async function mergeGroups(
  groups: DuplicateGroup[],
  storage: Storage,
  brief: MergeBriefOps,
  now: () => Date = () => new Date(),
): Promise<number> {
  for (const group of groups) {
    const plan = planMerge(group);
    if (!await brief.find(plan.keep)) {
      for (const alt of [...plan.remove].reverse()) {
        const found = await brief.find(alt);
        if (!found) continue;
        await brief.carry(found, plan.keep);
        break;
      }
    }
    for (const job of plan.remove) await storage.deleteJob(job);
    await storage.deleteJob(plan.keep);
    await storage.save({ ...plan.keep, scrapedAt: plan.scrapedAt, updatedAt: now().toISOString() });
  }
  return groups.length;
}
