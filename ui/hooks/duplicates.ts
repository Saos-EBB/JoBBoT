import { useCallback, useEffect, useState } from 'react';
import type { Job } from '../../scrapers/interface.ts';

// Spiegelt lib/duplicates.ts DuplicateGroup — kein gemeinsames Modul, weil lib/duplicates.ts
// node:fs anfasst und dieser Hook Teil des Browser-Bundles ist (Job-Typ selbst kommt
// weiterhin aus scrapers/interface.ts, das ist reine Typen, kein I/O).
type DuplicateGroup = { key: string; jobs: Job[] };

// active = ob der Duplicates-Tab gerade sichtbar ist. Nur beim Betreten geladen (kein
// Polling wie bei Scrape/Filter/Anschreiben) — Duplikatsuche ist eine synchrone, sofort
// fertige Leseoperation ohne Fortschritt, der sich zu beobachten lohnt.
export function useDuplicates(
  active: boolean,
  say: (msg: string, kind?: 'ok' | 'err') => void,
  refetchJobs: () => void,
) {
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[] | null>(null);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [selectedDupKeys, setSelectedDupKeys] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

  const loadDuplicates = useCallback(() => {
    setDuplicatesLoading(true);
    fetch('/api/duplicates')
      .then(r => r.json())
      .then((groups: DuplicateGroup[]) => setDuplicateGroups(groups))
      .finally(() => setDuplicatesLoading(false));
  }, []);

  useEffect(() => {
    if (active) loadDuplicates();
  }, [active, loadDuplicates]);

  // Behält je Gruppe das neueste Inserat (frischerer Titel/Beschreibung/Status),
  // übernimmt aber das erste Pull-Datum der älteren Duplikate ins JSON des Behaltenen
  // (siehe lib/duplicates.ts planMerge) — die älteren Dateien werden dabei gelöscht.
  async function mergeDuplicates(keys: string[] | 'all') {
    setMerging(true);
    try {
      const res = await fetch('/api/duplicates/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(keys === 'all' ? { all: true } : { keys }),
      });
      const data = await res.json() as { merged?: number };
      say(`${data.merged ?? 0} Duplikat-Gruppe(n) zusammengeführt`, 'ok');
      setSelectedDupKeys(new Set());
      loadDuplicates();
      refetchJobs();
    } catch (err) {
      say(`Zusammenführen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setMerging(false);
    }
  }

  return { duplicateGroups, duplicatesLoading, selectedDupKeys, setSelectedDupKeys, merging, loadDuplicates, mergeDuplicates };
}
