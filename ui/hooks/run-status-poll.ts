import { useEffect, useRef, useState } from 'react';

// Spiegelt scripts/routes/{scrape,filter,anschreiben}.ts RunSnapshot + laufspezifischen
// Fortschritt — kein gemeinsames Typ-Modul, weil der Server sonst Browser-untaugliche
// Imports (node:fs via lib/settings.ts etc.) ins UI-Bundle ziehen würde.
export type ScrapeStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  runId: string | null;
  sources: Record<string, { current: number; total: number }>;
  result?: { newTotal: number; skipTotal: number; offlineTotal: number; backTotal: number; perSource: { name: string; ok: boolean; newCount: number; skipCount: number; offlineCount: number; backCount: number; error?: string }[] };
  error?: string;
};
export type FilterRunStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  runId: string | null;
  current?: { i: number; total: number; title: string };
  result?: { matched: number; offstack: number; brutal: number };
  error?: string;
};
export type AnschreibenRunStatus = {
  status: 'idle' | 'running' | 'done' | 'error' | 'stopped';
  runId: string | null;
  current?: { i: number; total: number; title: string };
  result?: { generated: number; skipped: number; emailsFound: number; mailGenerated: number; nomailGenerated: number };
  error?: string;
};

// Ein einziger Poll-Tick für alle drei Läufe statt drei unabhängiger Timer — Scrape,
// Filter und Anschreiben teilen sich einen Promise.all-Request und einen selbst-
// planenden setTimeout, der nur weiterläuft, solange mindestens einer noch "running"
// ist (läuft für die gesamte Lebensdauer der App, nicht an eine Ansicht gebunden,
// damit die Sidebar-Fortschrittsanzeige auch bei Ansichtswechsel sichtbar bleibt).
// wake() lässt runScrapeNow/runFilterNow/runAnschreibenNow den nächsten Tick sofort
// auslösen, statt auf den nächsten 1500ms-Schritt zu warten.
//
// Reine Datenquelle: kein Toast, kein refetchJobs — was ein Lauf-Ende bedeutet, weiß
// dieser Hook nicht, das entscheiden die Aufrufer (siehe useScrapeRun/useFilterRun/
// useAnschreibenRun).
export function useRunStatusPoll() {
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterRunStatus | null>(null);
  const [anschreibenStatus, setAnschreibenStatus] = useState<AnschreibenRunStatus | null>(null);
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = async () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      try {
        const [s, f, a] = await Promise.all([
          fetch('/api/scrape/status').then(r => r.json()) as Promise<ScrapeStatus>,
          fetch('/api/filter/status').then(r => r.json()) as Promise<FilterRunStatus>,
          fetch('/api/anschreiben/status').then(r => r.json()) as Promise<AnschreibenRunStatus>,
        ]);
        setScrapeStatus(s);
        setFilterStatus(f);
        setAnschreibenStatus(a);

        const stillRunning = s.status === 'running' || f.status === 'running' || a.status === 'running';
        if (!cancelled && stillRunning) timeoutId = setTimeout(tick, 1500);
      } catch {
        // Server kurz nicht erreichbar — weiter versuchen statt die Schleife stillschweigend zu beenden
        if (!cancelled) timeoutId = setTimeout(tick, 1500);
      }
    };
    wakeRef.current = tick;
    tick();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  return { scrapeStatus, filterStatus, anschreibenStatus, wake: () => wakeRef.current() };
}
