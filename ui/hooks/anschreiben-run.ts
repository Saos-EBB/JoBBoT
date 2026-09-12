import { useEffect, useRef, useState } from 'react';
import { useGridStream, type LoadGridSection } from '../components/grid.tsx';
import type { AnschreibenRunStatus } from './run-status-poll.ts';
import type { Fit } from '../../scrapers/interface.ts';
import type { FolderId } from '../../lib/folders.ts';

// status/wake kommen aus useRunStatusPoll (gemeinsamer Poll-Tick für alle drei Läufe).
// setHighlightFolders ist der Kern-State aus app.tsx, hier nur geschrieben (per Setter
// injiziert statt selbst zu besitzen — highlightFolders zeigt auch Nicht-Anschreiben-
// Ordner an, gehört also der Sidebar, nicht diesem Hook). onStarted feuert nur bei
// erfolgreichem Start (kein 409) — app.tsx entscheidet, was das für seine eigene
// Job-Auswahl (selectedJobIds) bedeutet, der Hook kennt diesen State nicht.
export function useAnschreibenRun(
  status: AnschreibenRunStatus | null,
  wake: () => void,
  say: (msg: string, kind?: 'ok' | 'err') => void,
  refetchJobs: () => void,
  setHighlightFolders: (fn: (prev: Set<FolderId>) => Set<FolderId>) => void,
  onStarted: () => void,
) {
  // serverseitig fällt fit "brutal" immer auf "skipped" (generateAnschreiben() lehnt
  // das grundsätzlich ab, siehe lib/anschreiben.ts). Default spiegelt den CLI-Default
  // ohne --data: alle getriagten Jobs außer brutal.
  const [anschreibenFits, setAnschreibenFits] = useState<Set<Fit>>(new Set(['matched', 'offstack']));
  const [anschreibenLimit, setAnschreibenLimit] = useState('');
  const [anschreibenSections, setAnschreibenSections] = useState<LoadGridSection[]>([]);
  const [anschreibenStarting, setAnschreibenStarting] = useState(false);
  // Verhindert Toast/Refetch-Spam: der Server hält 'done' so lange, bis der nächste
  // Lauf startet — ohne diesen Merker würde jeder Poll-Tick (alle 1.5s) erneut feiern.
  const lastSeenRunId = useRef<string | null>(null);

  // SSE statt Polling fürs Lade-Grid — ein Event pro fertigem (oder fehlgeschlagenem)
  // Anschreiben, angehängt an anschreibenSections.
  useGridStream('/api/anschreiben/stream', setAnschreibenSections);

  useEffect(() => {
    if (!status) return;
    if ((status.status === 'done' || status.status === 'error' || status.status === 'stopped') && status.runId && status.runId !== lastSeenRunId.current) {
      lastSeenRunId.current = status.runId;
      refetchJobs();
      say(
        status.status === 'error' ? `Anschreiben fehlgeschlagen: ${status.error}`
        : status.status === 'stopped' ? `Anschreiben abgebrochen: ${status.result?.generated ?? 0} generiert, ${status.result?.emailsFound ?? 0} E-Mails gefunden`
        : `Anschreiben: ${status.result?.generated ?? 0} generiert, ${status.result?.skipped ?? 0} übersprungen, ${status.result?.emailsFound ?? 0} E-Mails gefunden`,
        status.status === 'error' ? 'err' : 'ok'
      );
      // Nur den Entwürfe-Ordner markieren, der wirklich einen neuen Job bekommen
      // hat — mailGenerated/nomailGenerated sind die Aufschlüsselung von `generated`
      // nach Mail-Status am Ende des Laufs (siehe lib/anschreiben-runner.ts).
      if (status.status !== 'error') {
        setHighlightFolders(prev => {
          const next = new Set(prev);
          if ((status.result?.mailGenerated ?? 0) > 0) next.add('mail/entwurf');
          if ((status.result?.nomailGenerated ?? 0) > 0) next.add('nomail/entwurf');
          return next;
        });
      }
    }
  }, [status, refetchJobs, say, setHighlightFolders]);

  // Ein Aufruf für beides: die Mehrfachauswahl in der Liste UND den einzelnen
  // "Neu generieren"-Button im Detail — beide wollen dieselbe Aktion für eine Menge
  // von Job-IDs, nur unterschiedlich groß.
  async function runAnschreibenNow(jobIds: string[]) {
    if (jobIds.length === 0) return;
    setAnschreibenStarting(true);
    setAnschreibenSections([]);
    try {
      const res = await fetch('/api/anschreiben', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds }),
      });
      if (res.status === 409) say('Anschreiben-Lauf läuft bereits', 'err');
      else onStarted();
      wake();
    } finally {
      setAnschreibenStarting(false);
    }
  }

  // Der Abort-Controller lebt serverseitig (scripts/routes/anschreiben.ts) — der Client
  // stößt den Abbruch nur per POST an, hält selbst keinen eigenen Abort-State.
  async function stopAnschreibenNow() {
    const res = await fetch('/api/anschreiben/stop', { method: 'POST' });
    if (res.status === 409) say('Kein Anschreiben-Lauf aktiv', 'err');
    // Erfolgsfall zeigt sich am Poll-Tick (status wechselt auf "stopped", eigener Toast
    // dort) — kein zweiter Toast hier, der nur den Lauf-Abschluss vorwegnehmen würde.
  }

  return {
    anschreibenFits, setAnschreibenFits, anschreibenLimit, setAnschreibenLimit,
    anschreibenStarting, anschreibenSections, setAnschreibenSections,
    runAnschreibenNow, stopAnschreibenNow,
  };
}
