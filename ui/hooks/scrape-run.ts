import { useEffect, useRef, useState } from 'react';
import { useGridStream, type LoadGridSection } from '../components/grid.tsx';
import type { ScrapeStatus } from './run-status-poll.ts';

// status/wake kommen aus useRunStatusPoll (gemeinsamer Poll-Tick für alle drei Läufe).
// viewRef ist der Kern-View-State aus app.tsx, nur gelesen — Tschobbo (ui/tschobbo.js)
// soll nur feuern, wenn das Scrape-Grid gerade sichtbar ist.
export function useScrapeRun(
  status: ScrapeStatus | null,
  wake: () => void,
  say: (msg: string, kind?: 'ok' | 'err') => void,
  refetchJobs: () => void,
  viewRef: { current: string },
) {
  const [scrapeSources, setScrapeSources] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [scrapeStarting, setScrapeStarting] = useState(false);
  const [scrapeSections, setScrapeSections] = useState<LoadGridSection[]>([]);
  // Verhindert Toast/Refetch-Spam: der Server hält 'done' so lange, bis der nächste
  // Lauf startet — ohne diesen Merker würde jeder Poll-Tick (alle 1.5s) erneut feiern.
  const lastSeenRunId = useRef<string | null>(null);

  useEffect(() => {
    fetch('/api/scrape/sources').then(r => r.json()).then((names: string[]) => {
      setScrapeSources(names);
      setSelectedSources(new Set(names));
    });
  }, []);

  // SSE fürs Lade-Grid — ein Event pro fertiger Seite/Batch je Quelle (siehe
  // scripts/routes/scrape.ts onUnitDone). onEvent ist der Tschobbo-Hook: nur wenn das
  // Scrape-Grid gerade sichtbar ist, sonst gäbe es keine echten Quadrat-Positionen zum
  // Anfassen. Einzige Stelle, die das Event feuert.
  useGridStream('/api/scrape/stream', setScrapeSections, event => {
    if (viewRef.current === 'scrape') window.dispatchEvent(new CustomEvent('tschobbo:unit', { detail: event }));
  });

  useEffect(() => {
    if (!status) return;
    if ((status.status === 'done' || status.status === 'error') && status.runId && status.runId !== lastSeenRunId.current) {
      lastSeenRunId.current = status.runId;
      refetchJobs();
      say(
        status.status === 'error' ? `Scrape fehlgeschlagen: ${status.error}`
        // Der Offline-Teil steht nur da, wenn wirklich etwas archiviert wurde —
        // ein "0 offline" in jedem Toast wäre eine Meldung ohne Nachricht.
        : `Scrape: ${status.result?.newTotal ?? 0} neu, ${status.result?.skipTotal ?? 0} dedup`
          + ((status.result?.offlineTotal ?? 0) > 0 ? `, ${status.result?.offlineTotal} offline archiviert` : '')
          + ((status.result?.backTotal ?? 0) > 0 ? `, ${status.result?.backTotal} zurückgeholt` : ''),
        status.status === 'error' ? 'err' : 'ok'
      );
    }
  }, [status, refetchJobs, say]);

  async function runScrapeNow() {
    setScrapeStarting(true);
    setScrapeSections([]);
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: [...selectedSources] }),
      });
      if (res.status === 409) say('Scrape läuft bereits', 'err');
      wake();
    } finally {
      setScrapeStarting(false);
    }
  }

  return {
    scrapeSources, selectedSources, setSelectedSources,
    scrapeStarting, scrapeSections, setScrapeSections, runScrapeNow,
  };
}
