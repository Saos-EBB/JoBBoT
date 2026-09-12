import { useState, useMemo, useEffect } from 'react';
import { FOLDER_IDS, inFolder, type FolderId } from '../../lib/folders.ts';
import type { Fit } from '../../scrapers/interface.ts';
import type { JobWithBrief } from '../app.tsx';

// Der zuletzt gewählte Ordner, damit er einen Reload überlebt. Vorher war der
// Startwert hart 'mail/entwurf': nach F5 landete man dort, auch wenn man vorher in
// 'nomail/entwurf' stand — und weil BEIDE Ordner in der Seitenleiste "Entwürfe"
// heißen (siehe GROUPS in app.tsx), sah der leere Nachbarordner aus, als wären die
// Entwürfe verschwunden. Der Ordner ist eine Ortsangabe des Nutzers, kein Zustand
// eines Laufs; deshalb hier localStorage, anders als bei highlightFolders (bewusst
// nur im Speicher, siehe app.tsx).
const FOLDER_KEY = 'jobbot.folder';
const FOLDER_DEFAULT: FolderId = 'mail/entwurf';

// Beide Zugriffe können werfen (privates Fenster, blockierte Site-Daten) — und ein
// gespeicherter Wert kann aus einer Fassung mit anderen FOLDER_IDS stammen. Beides
// fällt still auf den Standard zurück: eine vergessene Ortsangabe ist kein Fehler.
function ladeOrdner(): FolderId {
  try {
    const gespeichert = localStorage.getItem(FOLDER_KEY);
    if (gespeichert && (FOLDER_IDS as readonly string[]).includes(gespeichert)) return gespeichert as FolderId;
  } catch { /* kein localStorage — Standard */ }
  return FOLDER_DEFAULT;
}

function merkeOrdner(id: FolderId): void {
  try { localStorage.setItem(FOLDER_KEY, id); } catch { /* nicht merkbar — dann eben nicht */ }
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function useFolderView(jobs: JobWithBrief[], replyOnly: boolean, fitKeys: readonly Fit[]) {
  // Lazy Initializer (Funktion statt Aufruf): localStorage wird einmal beim Mount
  // gelesen, nicht bei jedem Render.
  const [folder, setFolder] = useState<FolderId>(ladeOrdner);
  const [fit, setFit] = useState<Fit | 'alle' | 'unbewertet'>('alle');
  const [q, setQ] = useState('');

  // Jeden Ordnerwechsel merken — egal wodurch ausgelöst (Klick, Schublade, oder der
  // Startordner-Effekt in app.tsx). Ein Effect statt eines Aufrufs in jedem
  // Klick-Handler: sonst gäbe es Wege, den Ordner zu wechseln, ohne ihn zu merken.
  useEffect(() => { merkeOrdner(folder); }, [folder]);

  const counts = useMemo(() => {
    const c: Partial<Record<FolderId, number>> = {};
    for (const id of FOLDER_IDS) c[id] = jobs.filter(j => inFolder(j, id)).length;
    return c;
  }, [jobs]);

  const inCurrentFolder = useMemo(() => jobs.filter(j => inFolder(j, folder)), [jobs, folder]);

  const fitCounts = useMemo(() => {
    const c: Record<string, number> = { alle: inCurrentFolder.length };
    for (const k of fitKeys) c[k] = inCurrentFolder.filter(j => j.fit === k).length;
    c.unbewertet = inCurrentFolder.filter(j => j.fit === null).length;
    return c;
  }, [inCurrentFolder, fitKeys]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return inCurrentFolder
      .filter(j => (fit === 'alle' ? true : fit === 'unbewertet' ? j.fit === null : j.fit === fit))
      .filter(j => !s || (j.company + ' ' + j.title + ' ' + (j.location ?? '')).toLowerCase().includes(s))
      .filter(j => !(folder === 'log/gesendet' && replyOnly) || j.replyReceivedAt != null)
      .sort((a, b) => daysAgo(a.scrapedAt) - daysAgo(b.scrapedAt));
  }, [inCurrentFolder, fit, q, folder, replyOnly]);

  // Auswählbar ist alles ausser Gesendetem — das ist überall sonst in der UI
  // schreibgeschützt (siehe Detail-Leiste), und eine Mehrfachaktion darf dieselbe
  // Regel nicht hintenrum aushebeln.
  const selectable = useMemo(() => list.filter(j => j.status !== 'gesendet'), [list]);

  return { folder, setFolder, fit, setFit, q, setQ, counts, inCurrentFolder, fitCounts, list, selectable };
}
