import { useEffect, useRef, useState } from 'react';
import { useGridStream, type LoadGridSection } from '../components/grid.tsx';
import type { FilterRunStatus } from './run-status-poll.ts';

type FilterMode = 'llm' | 'regex';

// status/wake kommen aus useRunStatusPoll (gemeinsamer Poll-Tick für alle drei Läufe).
export function useFilterRun(
  status: FilterRunStatus | null,
  wake: () => void,
  say: (msg: string, kind?: 'ok' | 'err') => void,
  refetchJobs: () => void,
) {
  const [filterMode, setFilterMode] = useState<FilterMode>('regex');
  const [filterScope, setFilterScope] = useState<'new' | 'all'>('new');
  const [filterStarting, setFilterStarting] = useState(false);
  const [filterSections, setFilterSections] = useState<LoadGridSection[]>([]);
  // Verhindert Toast/Refetch-Spam: der Server hält 'done' so lange, bis der nächste
  // Lauf startet — ohne diesen Merker würde jeder Poll-Tick (alle 1.5s) erneut feiern.
  const lastSeenRunId = useRef<string | null>(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then((s: { filterMode: FilterMode }) => setFilterMode(s.filterMode));
  }, []);

  // SSE fürs Lade-Grid — ein Event pro fertigem 10er-Batch je Ergebnis-Kategorie
  // (Match/Offstack/Brutal, siehe scripts/routes/filter.ts).
  useGridStream('/api/filter/stream', setFilterSections);

  useEffect(() => {
    if (!status) return;
    if ((status.status === 'done' || status.status === 'error') && status.runId && status.runId !== lastSeenRunId.current) {
      lastSeenRunId.current = status.runId;
      refetchJobs();
      say(
        status.status === 'error' ? `Filter fehlgeschlagen: ${status.error}` : `Filter: ${status.result?.matched ?? 0} Match, ${status.result?.offstack ?? 0} Offstack, ${status.result?.brutal ?? 0} Brutal`,
        status.status === 'error' ? 'err' : 'ok'
      );
    }
  }, [status, refetchJobs, say]);

  async function runFilterNow() {
    setFilterStarting(true);
    setFilterSections([]);
    try {
      const res = await fetch('/api/filter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: filterMode, scope: filterScope }),
      });
      if (res.status === 409) say('Filter läuft bereits', 'err');
      wake();
    } finally {
      setFilterStarting(false);
    }
  }

  return {
    filterMode, setFilterMode, filterScope, setFilterScope,
    filterStarting, filterSections, setFilterSections, runFilterNow,
  };
}
