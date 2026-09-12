import { useState, useEffect, useMemo } from 'react';
import { canGenerateAnschreiben, type FolderId } from '../../lib/folders.ts';
import type { Job } from '../../scrapers/interface.ts';

// Auswahl für die "Anschreiben erstellen"-Aktion — nur im "jobs"-Ordner relevant
// (matched/uncertain landen laut STATUS_MAP nirgendwo sonst), deshalb bei
// Ordnerwechsel zurückgesetzt statt über Ordner hinweg mitzuschleppen.
export function useSelection(jobs: Job[], folder: FolderId) {
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  useEffect(() => { setSelectedJobIds(new Set()); }, [folder]);

  function toggleSelect(id: string) {
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Anschreiben ist die eine Mehrfachaktion mit einer engeren Bedingung als
  // "ausgewählt": der Lauf verarbeitet nur getriagte, nicht-brutale Jobs
  // (canGenerateAnschreiben). Statt sie unauswählbar zu machen — sie sind ja für
  // Löschen/Verschieben sehr wohl gemeint — steht die Zahl am Knopf.
  const briefbar = useMemo(
    () => [...selectedJobIds].filter(id => { const j = jobs.find(x => x.id === id); return j != null && canGenerateAnschreiben(j); }),
    [selectedJobIds, jobs],
  );

  return { selectedJobIds, setSelectedJobIds, toggleSelect, briefbar };
}
