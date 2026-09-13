import type { Dispatch, SetStateAction } from 'react';
import type { Job, Fit } from '../../scrapers/interface.ts';
import type { JobWithBrief } from '../app.tsx';

// Die Server-schreibenden Status-/Fit-Aktionen, die vorher inline in JobbotUI standen
// und als einzige Job-Mutationen KEINEN eigenen Hook (und damit keinen Test) hatten,
// obwohl es die meistbenutzten sind. Kein useState: reine Closures über den vom
// Aufrufer gereichten State/die Setter — dieselbe Form wie useJobEdits, direkt testbar.
//
// Alle vier sind pessimistisch: erst der Server (POST /api/jobs/:id), lokaler State
// erst NACH der Antwort — sonst zeigt die UI einen Status, den das Job-JSON nicht hat.
export interface JobMutationsDeps {
  jobs: JobWithBrief[];
  selectedJobIds: Set<string>;
  say: (msg: string, kind?: 'ok' | 'err') => void;
  patch: (id: string, p: Partial<JobWithBrief>) => void;
  setJobs: Dispatch<SetStateAction<JobWithBrief[]>>;
  setSelectedJobIds: (s: Set<string>) => void;
  setDetailOpen: (open: boolean) => void;
  runAnschreiben: (ids: string[]) => void;
}

export function useJobMutations(deps: JobMutationsDeps) {
  const { jobs, selectedJobIds, say, patch, setJobs, setSelectedJobIds, setDetailOpen, runAnschreiben } = deps;

  async function move(id: string, status: Job['status'], msg: string) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { say('Speichern fehlgeschlagen', 'err'); return; }
    patch(id, { status });
    say(msg);
    setDetailOpen(false);
  }

  async function saveFit(id: string, fit: Fit) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fit }),
    });
    if (res.ok) patch(id, { fit });
    else say('Speichern fehlgeschlagen', 'err');
  }

  // generateAnschreiben() (lib/anschreiben.ts) generiert nur für status "triaged" mit
  // fit !== "brutal" — ein bereits generierter Job muss also erst dorthin zurück, bevor
  // der Lauf ihn wieder aufgreift.
  async function regenerate(job: JobWithBrief) {
    if (job.fit == null || job.fit === 'brutal') {
      say('Neu generieren nicht möglich — kein Filter-Urteil bekannt', 'err');
      return;
    }
    const status: Job['status'] = 'triaged';
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { say('Zurücksetzen fehlgeschlagen', 'err'); return; }
    patch(job.id, { status });
    runAnschreiben([job.id]);
  }

  // Mehrfachaktion = dieselbe Route wie die Einzelaktion, n-mal. Kein Sammel-Endpunkt:
  // jeder Job ist eine eigene JSON-Datei (storage/json-store.ts), serverseitig wäre das
  // exakt dieselbe Schleife. Lokaler State wird nur für die Jobs angefasst, die durchkamen.
  async function runBulk(patchFor: (job: JobWithBrief) => Partial<Pick<Job, 'status' | 'fit'>>, verb: string) {
    const targets = [...selectedJobIds]
      .map(id => jobs.find(j => j.id === id))
      .filter((j): j is JobWithBrief => j != null);
    if (targets.length === 0) return;

    const done = (
      await Promise.all(
        targets.map(async j => {
          const p = patchFor(j);
          const res = await fetch(`/api/jobs/${j.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(p),
          });
          return res.ok ? { id: j.id, p } : null;
        }),
      )
    ).filter((r): r is { id: string; p: Partial<Pick<Job, 'status' | 'fit'>> } => r != null);

    setJobs(js => js.map(j => { const hit = done.find(d => d.id === j.id); return hit ? { ...j, ...hit.p } : j; }));
    setSelectedJobIds(new Set());
    const failed = targets.length - done.length;
    if (failed) say(`${done.length} ${verb}, ${failed} fehlgeschlagen`, 'err');
    else say(`${done.length} ${verb}`);
  }

  return { move, saveFit, regenerate, runBulk };
}
