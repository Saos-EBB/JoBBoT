import type { Job, JobStatus } from '../scrapers/interface.ts';

// Rein UI-seitige Sicht auf den Job-Status, nie gespeichert (siehe scrapers/interface.ts
// für den Ownership-Split der gespeicherten JobStatus-Werte). Pipeline-Zone-Werte werden
// hier zusammengefasst, UI-Zone-Werte laufen 1:1 durch.
export type Status =
  | 'jobs' | 'entwurf' | 'freigegeben' | 'postausgang'
  | 'gesendet' | 'aussortiert' | 'geloescht' | 'fehler' | 'offline';

// "triaged" fehlt hier bewusst — sitzt weder fix auf "jobs" noch auf "aussortiert",
// sondern hängt von fit ab (brutal → aussortiert, sonst → jobs), siehe deriveStatus().
const STATUS_MAP: Record<Exclude<JobStatus, 'triaged'>, Status> = {
  new: 'jobs',
  generated: 'entwurf',
  freigegeben: 'freigegeben',
  postausgang: 'postausgang',
  gesendet: 'gesendet',
  geloescht: 'geloescht',
  fehler: 'fehler',
  offline: 'offline',
};

export function deriveStatus(job: Job): Status {
  if (job.status === 'triaged') return job.fit === 'brutal' ? 'aussortiert' : 'jobs';
  return STATUS_MAP[job.status];
}

// Zentral, weil sie an vier Stellen gebraucht wird: generateAnschreiben() selbst
// (lib/anschreiben.ts), Server-Vorfilter, Checkbox-Zustand und "Alle sichtbaren
// auswählen". Status "new" sitzt laut STATUS_MAP mit im "jobs"-Ordner, ist aber
// ungefiltert und damit ungeeignet.
export function canGenerateAnschreiben(job: Job): boolean {
  return job.status === 'triaged' && job.fit !== 'brutal';
}

function hasMail(job: Job): boolean {
  return job.email != null;
}

// "jobs" (Triage-Warteschlange, kein Anschreiben) sowie aussortiert/gesendet/
// offline/geloescht/fehler sind je ein einzelner Ordner (Mail-Status ist dort irrelevant);
// nur entwurf/freigegeben splitten nach Mail; postausgang ist per Definition
// immer mail/* (kein Draft ohne Empfängeradresse).
export const FOLDER_IDS = [
  'jobs',
  'mail/entwurf', 'mail/freigegeben', 'mail/postausgang',
  'nomail/entwurf', 'nomail/freigegeben',
  'log/gesendet', 'log/aussortiert', 'log/offline', 'log/geloescht', 'log/fehler',
] as const;

export type FolderId = (typeof FOLDER_IDS)[number];

export function inFolder(job: Job, folderId: FolderId): boolean {
  const status = deriveStatus(job);
  if (folderId === 'jobs') return status === 'jobs';

  const [scope, sub] = folderId.split('/') as [string, Status];
  if (status !== sub) return false;
  if (scope === 'log') return true;
  if (scope === 'mail') return hasMail(job);
  if (scope === 'nomail') return !hasMail(job);
  return false;
}

export function folderCounts(jobs: Job[]): Record<FolderId, number> {
  const counts = Object.fromEntries(FOLDER_IDS.map(id => [id, 0])) as Record<FolderId, number>;
  for (const job of jobs) {
    for (const id of FOLDER_IDS) {
      if (inFolder(job, id)) counts[id]++;
    }
  }
  return counts;
}
