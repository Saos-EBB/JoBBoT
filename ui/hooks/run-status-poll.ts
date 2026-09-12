import { useEffect, useRef, useState } from 'react';
import type { ScrapeStatusResponse } from '../../scripts/routes/scrape.ts';
import type { FilterStatusResponse } from '../../scripts/routes/filter.ts';
import type { AnschreibenStatusResponse } from '../../scripts/routes/anschreiben.ts';

// import type wird von esbuild vollständig entfernt (siehe scripts/build-ui.ts) — die
// node:fs-Importe dieser Routendateien landen dadurch nie im Browser-Bundle, nur die
// Typdeklaration selbst.
export type ScrapeStatus = ScrapeStatusResponse;
export type FilterRunStatus = FilterStatusResponse;
export type AnschreibenRunStatus = AnschreibenStatusResponse;

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
