import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Search,
  Mail,
  Globe,
  FileText,
  CheckCircle2,
  Send,
  Trash2,
  AlertTriangle,
  RotateCw,
  ExternalLink,
  ChevronLeft,
  Undo2,
  ListFilter,
  XCircle,
  Paperclip,
  Download,
  Filter as FilterIcon,
  Play,
  Square,
  Copy,
  Layers,
  Calendar,
  Menu,
  Archive,
} from 'lucide-react';
import type { Job, Fit } from '../scrapers/interface.ts';
import { FOLDER_IDS, inFolder, canGenerateAnschreiben, type FolderId } from '../lib/folders.ts';
import { FOLLOW_UP_DAYS, dueFollowUps, daysSinceLastContact } from '../lib/followup.ts';
import { CSS } from './styles.ts';
import { type LoadGridSection, LoadGridPanel } from './components/grid.tsx';
import { type CalendarEvent, CalendarView, CAL_TYPES, CAL_COLOR } from './components/calendar.tsx';
import { UMKREIS_GRUPPEN, istLandesbegriff, ChipListe, PortalBlock, RohAnsicht, useSettingsConfig } from './components/settings.tsx';
import { useAttachment } from './hooks/attachment.ts';
import { useCcAddress } from './hooks/cc.ts';
import { useDuplicates } from './hooks/duplicates.ts';
import { useRunStatusPoll } from './hooks/run-status-poll.ts';
import { useScrapeRun } from './hooks/scrape-run.ts';
import { useFilterRun } from './hooks/filter-run.ts';
import { useAnschreibenRun } from './hooks/anschreiben-run.ts';
import { useMailSync } from './hooks/mail-sync.ts';

// /api/jobs joint das Anschreiben serverseitig dazu (siehe scripts/ui-server.ts) —
// es lebt in data/anschreiben/{slug}.md, nicht im Job-JSON. Deshalb ist `brief` hier
// und nicht auf dem Job-Typ selbst: ein Feld, das nur diese Antwort hat, kein Feld,
// das je zurückgeschrieben wird (Speichern einer Bearbeitung ist ein eigener Endpunkt).
type JobWithBrief = Job & { brief: string | null };

/* ------------------------------------------------------------------ *
 * Design tokens
 *
 * Ganze App ist bewusst entsättigt. Die EINZIGE Farbe im Interface ist
 * das Fit-Urteil (Match/Offstack/Brutal) — damit liest sich die Liste
 * als Streifen von Urteilen, bevor du ein Wort gelesen hast: Match blau,
 * Offstack gelb, Brutal orange. Rot ist exklusiv für Fehler reserviert,
 * deshalb bleibt "brutal" Orange und wird nie Rot, obwohl es das
 * Aussortier-Urteil ist.
 *
 * Tiefe = 4 Stufen Elevation: ink < slate < panel < paper.
 * Das Anschreiben ist die einzige helle Fläche der App — weil es das
 * einzige ist, das die App verlässt.
 * ------------------------------------------------------------------ */

// Ziele der Mehrfachaktion "Verschieben" — bewusst nur die drei Ordner, die reine
// Einsortierung sind. Entwurf/Freigegeben/Postausgang/Gesendet sind Pipeline-Stufen
// mit Vorbedingungen (Brief da? Gmail-Entwurf angelegt?), die ein Sammel-Zug still
// überspringen würde; die bleiben bei ihren Einzelaktionen im Detail.
//
// "Jobs" und "Aussortiert" sind BEIDE status 'triaged' und unterscheiden sich nur im
// fit (lib/folders.ts deriveStatus: brutal → aussortiert, sonst → jobs). Ein Zug nach
// Jobs muss ein brutales Urteil deshalb mitnehmen, sonst fällt der Job sofort wieder
// zurück nach Aussortiert — sichtbar als "nichts passiert".
type MoveTarget = 'jobs' | 'aussortiert' | 'geloescht';
const MOVE_TARGETS: { value: MoveTarget; label: string }[] = [
  { value: 'jobs', label: 'Jobs' },
  { value: 'aussortiert', label: 'Aussortiert' },
  { value: 'geloescht', label: 'Gelöscht' },
];
const MOVE_PATCH: Record<MoveTarget, (job: Job) => Partial<Pick<Job, 'status' | 'fit'>>> = {
  jobs: job => (job.fit === 'brutal' ? { status: 'triaged', fit: 'offstack' } : { status: 'triaged' }),
  aussortiert: () => ({ status: 'triaged', fit: 'brutal' }),
  geloescht: () => ({ status: 'geloescht' }),
};

const FIT: Record<Fit, { label: string; color: string }> = {
  matched: { label: 'Match', color: 'var(--fit-matched)' },
  offstack: { label: 'Offstack', color: 'var(--fit-offstack)' },
  brutal: { label: 'Brutal', color: 'var(--fit-brutal)' },
};

// fit ist nullable (scrapers/interface.ts) und bekommt bewusst KEINEN Default hier im
// UI — lib/filter.ts setzt fit inzwischen zwar automatisch (1:1 an status gekoppelt,
// siehe STATUS_FIT), aber manuell gesetzte/zurückgesetzte Jobs können weiterhin null
// sein. Ein grob geratener Fit sähe identisch aus wie ein echtes Urteil und wäre damit
// schlimmer als gar keiner — null bekommt eine neutrale Haarlinie statt einer der drei
// Urteilsfarben.
function fitColor(fit: Fit | null): string {
  return fit ? FIT[fit].color : 'var(--line)';
}

/* ------------------------------------------------------------------ *
 * Sidebar-Gruppen. inFolder()/FOLDER_IDS kommen aus lib/folders.ts statt aus einer
 * lokalen Kopie: die Ownership-Split-Logik (Pipeline-Zone vs. UI-Zone Status, siehe
 * scrapers/interface.ts) lebt an genau einer Stelle. Eine zweite, "vereinfachte"
 * inFolder hier würde bei der nächsten Statusänderung lautlos auseinanderlaufen.
 * ------------------------------------------------------------------ */
const GROUPS: { head: string | null; icon: typeof Mail | null; folders: { id: FolderId; label: string; icon: typeof Mail; err?: boolean }[] }[] = [
  {
    head: null,
    icon: null,
    folders: [{ id: 'jobs', label: 'Jobs', icon: ListFilter }],
  },
  {
    head: 'Mit Mail',
    icon: Mail,
    folders: [
      { id: 'mail/entwurf', label: 'Entwürfe', icon: FileText },
      { id: 'mail/freigegeben', label: 'Freigegeben', icon: CheckCircle2 },
      // postausgang: Gmail-Entwurf per IMAP APPEND erzeugt, Versand noch nicht bestätigt
      // (siehe findings/HANDOFF-gmail-versand.md, Abschnitt 1+9). Nicht "gesendet" —
      // das wäre eine Lüge, solange niemand den Entwurf in Gmail abgeschickt hat.
      { id: 'mail/postausgang', label: 'Postausgang', icon: Send },
    ],
  },
  {
    head: 'Ohne Mail',
    icon: Globe,
    folders: [
      { id: 'nomail/entwurf', label: 'Entwürfe', icon: FileText },
      { id: 'nomail/freigegeben', label: 'Bereit', icon: CheckCircle2 },
    ],
  },
  {
    head: 'Verlauf',
    icon: null,
    folders: [
      { id: 'log/gesendet', label: 'Gesendet', icon: Send },
      { id: 'log/aussortiert', label: 'Aussortiert', icon: XCircle },
      // Nicht mehr online — vom Scrape-Lauf archiviert, nicht vom Nutzer aussortiert
      // (siehe lib/scrape-runner.ts). Steht hier statt in einer eigenen Gruppe, weil
      // es wie gesendet/geloescht eine Endstation ist, aus der ein neuer Scrape-Lauf
      // den Job von selbst zurueckholt, wenn das Inserat wieder auftaucht.
      { id: 'log/offline', label: 'Offline', icon: Archive },
      { id: 'log/geloescht', label: 'Gelöscht', icon: Trash2 },
      { id: 'log/fehler', label: 'Fehler', icon: AlertTriangle, err: true },
    ],
  },
];

// Sagt, was der leere Zustand bedeutet, nicht dass er leer ist — "Keine Einträge" ist für
// jeden Ordner wahr und hilft nirgends. "jobs" ist der Posteingang: eine leere Triage-Queue
// heißt "nichts Neues reingekommen", kein Fehlerzustand.
// Beschriftung fuer die mobile Kopfzeile — sie ist dort die einzige Ortsangabe, weil
// die Seitenleiste mit ihrer Markierung hinter der Schublade liegt. Ordner-Namen kommen
// aus GROUPS statt aus einer zweiten Liste, sonst driften sie auseinander.
const FOLDER_LABEL: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap(g => g.folders.map(f => [f.id, f.label])),
);
const VIEW_LABEL: Partial<Record<string, string>> = {
  attachment: 'Anhang', cc: 'CC', calendar: 'Kalender', scrape: 'Scrape',
  filter: 'Filter', duplicates: 'Duplikate', anschreiben: 'Anschreiben', nachfass: 'Nachfassen',
  suche: 'Suche',
};

const EMPTY_COPY: Record<FolderId, string> = {
  'jobs': 'Nichts Neues.',
  'mail/entwurf': 'Keine Entwürfe zu prüfen.',
  'mail/freigegeben': 'Nichts wartet auf Versand.',
  'mail/postausgang': 'Kein Entwurf unterwegs.',
  'nomail/entwurf': 'Keine Entwürfe zu prüfen.',
  'nomail/freigegeben': 'Nichts bereit zum Bewerben.',
  'log/gesendet': 'Noch nichts gesendet.',
  'log/aussortiert': 'Nichts aussortiert.',
  'log/offline': 'Kein Inserat ist offline gegangen.',
  'log/geloescht': 'Nichts gelöscht.',
  'log/fehler': 'Keine Fehler.',
};

// Der zuletzt gewählte Ordner, damit er einen Reload überlebt. Vorher war der
// Startwert hart 'mail/entwurf': nach F5 landete man dort, auch wenn man vorher in
// 'nomail/entwurf' stand — und weil BEIDE Ordner in der Seitenleiste "Entwürfe"
// heißen (siehe GROUPS), sah der leere Nachbarordner aus, als wären die Entwürfe
// verschwunden. Der Ordner ist eine Ortsangabe des Nutzers, kein Zustand eines Laufs;
// deshalb hier localStorage, anders als bei highlightFolders (bewusst nur im Speicher).
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

function firstLine(t: string | null): string {
  if (!t) return '—';
  const l = t.split('\n').filter(x => x.trim() && !/^Sehr geehrte/.test(x));
  return l[0] ? l[0].slice(0, 90) : '—';
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// Manche älteren Beschreibungen haben noch HTML-Entities aus der Zeit vor der
// normalizeDescription-Migration (&Ouml; etc.). Browser-natives Decoding statt
// eigenem Regex-Parser — der echte Fix gehört in den Scraper, nicht hierher.
function decodeEntities(text: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

export default function JobbotUI() {
  const [jobs, setJobs] = useState<JobWithBrief[]>([]);
  // Lazy Initializer (Funktion statt Aufruf): localStorage wird einmal beim Mount
  // gelesen, nicht bei jedem Render.
  const [folder, setFolder] = useState<FolderId>(ladeOrdner);
  const [fit, setFit] = useState<Fit | 'alle' | 'unbewertet'>('alle');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<'brief' | 'inserat'>('brief');
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  // 'attachment'/'scrape'/'filter' sind keine Ordner (kein FolderId, kein Job-Filter)
  // — eigene, simple UI-Modi, die Liste+Detail durch eine Vollbild-Ansicht ersetzen.
  const [view, setView] = useState<'jobs' | 'attachment' | 'cc' | 'scrape' | 'filter' | 'duplicates' | 'anschreiben' | 'calendar' | 'nachfass' | 'suche'>('jobs');
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  // Auswahl für die "Anschreiben erstellen"-Aktion — nur im "jobs"-Ordner relevant
  // (matched/uncertain landen laut STATUS_MAP nirgendwo sonst), deshalb bei
  // Ordnerwechsel zurückgesetzt statt über Ordner hinweg mitzuschleppen.
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());

  // Sidebar-Ordner mit frisch generierten Anschreiben, die noch nicht angesehen wurden —
  // nur im Speicher (kein localStorage, bewusst so einfach wie möglich): ein Reload
  // löscht die Markierung, das ist unkritisch, weil die betroffenen Jobs im Ordner
  // ohnehin weiter sichtbar bleiben. Aus geht ausschließlich per Klick auf den Ordner.
  const [highlightFolders, setHighlightFolders] = useState<Set<FolderId>>(new Set());
  const ta = useRef<HTMLTextAreaElement>(null);
  // Für den Tschobbo-Hook im Scrape-SSE-Effect unten (der nur einmal läuft,
  // `view` also sonst als Closure einfrieren würde).
  const viewRef = useRef(view);
  viewRef.current = view;

  const say = useCallback((m: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg: m, kind });
    setTimeout(() => setToast(null), 1900);
  }, []);

  const refetchJobs = useCallback(() => {
    fetch('/api/jobs')
      .then(r => r.json())
      .then((data: JobWithBrief[]) => setJobs(data));
  }, []);

  useEffect(() => { refetchJobs(); }, [refetchJobs]);

  // Server-Schreiben unten. Es gibt bewusst keinen Weg, patch() direkt aus einem
  // Button-Handler aufzurufen: jede Statusmaschinen-Aktion geht zuerst über den
  // Server (pessimistisches Update) — sonst zeigt die UI einen Status, den die
  // Job-JSON gar nicht hat, und genau das war über diese ganze Migration hinweg
  // das eine, was nicht passieren darf (siehe postausgang/gesendet-Unterscheidung).
  const patch = (id: string, p: Partial<JobWithBrief>) =>
    setJobs(js => js.map(j => (j.id === id ? { ...j, ...p } : j)));

  const { attachment, uploadAttachment, removeAttachment } = useAttachment(view === 'attachment', say);
  const { cc, ccInput, setCcInput, saveCcNow, removeCc } = useCcAddress(view === 'cc', say);
  const {
    duplicateGroups, duplicatesLoading, selectedDupKeys, setSelectedDupKeys,
    merging, loadDuplicates, mergeDuplicates,
  } = useDuplicates(view === 'duplicates', say, refetchJobs);
  const {
    schema, sources, setSources, umkreis, setUmkreis,
    cfgBackup, cfgDirty, setCfgDirty, cfgErrors, cfgBusy, rohOffen, setRohOffen,
    saveConfig, restoreConfig, kaputteAnfragen, sourcesFehlerhaft, repariereAnfrage,
  } = useSettingsConfig(view === 'suche', say);

  const { scrapeStatus, filterStatus, anschreibenStatus, wake: pollRunsNow } = useRunStatusPoll();
  const {
    scrapeSources, selectedSources, setSelectedSources,
    scrapeStarting, scrapeSections, setScrapeSections, runScrapeNow,
  } = useScrapeRun(scrapeStatus, pollRunsNow, say, refetchJobs, viewRef);
  const {
    filterMode, setFilterMode, filterScope, setFilterScope,
    filterStarting, filterSections, setFilterSections, runFilterNow,
  } = useFilterRun(filterStatus, pollRunsNow, say, refetchJobs);
  const {
    anschreibenFits, setAnschreibenFits, anschreibenLimit, setAnschreibenLimit,
    anschreibenStarting, anschreibenSections, setAnschreibenSections,
    runAnschreibenNow, stopAnschreibenNow,
  } = useAnschreibenRun(anschreibenStatus, pollRunsNow, say, refetchJobs, setHighlightFolders, () => setSelectedJobIds(new Set()));

  // Tschobbo-Hook Teil 2 (ui/tschobbo.js): Die geworfenen Klumpen hängen an
  // <body>, nicht im React-Baum — ohne dieses Event blieben sie beim Wechsel auf
  // Jobs/Kalender/… sichtbar. Beim Zurückkommen auf ein fertiges Grid wirft
  // Tschobbo den letzten Stand neu auf (Animation wiederholt sich), weil die
  // Klumpen beim Verlassen weggeräumt wurden. Läuft gerade ein Scrape, übernimmt
  // der Stream oben — dann kein Nachbau.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('tschobbo:view', { detail: { active: view === 'scrape' } }));
    if (view !== 'scrape' || scrapeStatus?.status === 'running' || scrapeSections.length === 0) return;
    // Ein Frame Abstand: das Grid muss erst gemountet sein, sonst findet Tschobbo
    // keine Quadrate als Wurfziele.
    const raf = requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('tschobbo:replay')));
    return () => cancelAnimationFrame(raf);
    // Absicht: nur beim Ansichtswechsel, nicht bei jeder Section-Änderung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const {
    replyOnly, setReplyOnly, repliesFetching, gmailSyncing,
    followUpSelection, setFollowUpSelection, followUpBusy,
    fetchReplies, syncGmail, runFollowUps, createDraft, sendDirect,
  } = useMailSync(say, refetchJobs, setCalendarEvents, patch, setDetailOpen);

  // Wie Duplikate: nur beim Betreten laden, kein Polling — der Kalender liest einen
  // Snapshot, keinen laufenden Prozess.
  useEffect(() => {
    if (view === 'calendar') fetch('/api/calendar').then(r => r.json()).then(setCalendarEvents);
  }, [view]);

  // generateAnschreiben() (lib/anschreiben.ts) generiert nur für status "triaged" mit
  // fit !== "brutal" — ein bereits generierter Job (status "generated" o.ä.) muss also
  // erst dorthin zurück, bevor der Lauf ihn wieder aufgreift.
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
    runAnschreibenNow([job.id]);
  }

  const counts = useMemo(() => {
    const c: Partial<Record<FolderId, number>> = {};
    for (const id of FOLDER_IDS) c[id] = jobs.filter(j => inFolder(j, id)).length;
    return c;
  }, [jobs]);

  const inCurrentFolder = useMemo(() => jobs.filter(j => inFolder(j, folder)), [jobs, folder]);

  const fitCounts = useMemo(() => {
    const c: Record<string, number> = { alle: inCurrentFolder.length };
    for (const k of Object.keys(FIT)) c[k] = inCurrentFolder.filter(j => j.fit === k).length;
    c.unbewertet = inCurrentFolder.filter(j => j.fit === null).length;
    return c;
  }, [inCurrentFolder]);

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
  // Anschreiben ist die eine Mehrfachaktion mit einer engeren Bedingung als
  // "ausgewählt": der Lauf verarbeitet nur getriagte, nicht-brutale Jobs
  // (canGenerateAnschreiben). Statt sie unauswählbar zu machen — sie sind ja für
  // Löschen/Verschieben sehr wohl gemeint — steht die Zahl am Knopf.
  const briefbar = useMemo(
    () => [...selectedJobIds].filter(id => { const j = jobs.find(x => x.id === id); return j != null && canGenerateAnschreiben(j); }),
    [selectedJobIds, jobs],
  );

  const job = jobs.find(j => j.id === sel) ?? null;
  const shown = list.some(j => j.id === sel) ? job : null;

  useEffect(() => {
    if (!list.some(j => j.id === sel)) setSel(list[0]?.id ?? null);
  }, [list, sel]);

  // Auswahl nur im "jobs"-Ordner sinnvoll (siehe selectedJobIds oben) — beim
  // Verlassen zurücksetzen, sonst überlebt eine Auswahl unsichtbar den Wechsel.
  useEffect(() => { setSelectedJobIds(new Set()); }, [folder]);

  // Jeden Ordnerwechsel merken — egal wodurch ausgelöst (Klick, Schublade, oder der
  // Startordner-Effekt weiter unten). Ein Effect statt eines Aufrufs in jedem
  // Klick-Handler: sonst gäbe es Wege, den Ordner zu wechseln, ohne ihn zu merken.
  useEffect(() => { merkeOrdner(folder); }, [folder]);

  function toggleSelect(id: string) {
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => setTab(shown?.status === 'fehler' ? 'inserat' : 'brief'), [sel, shown?.status]);

  // Textarea auf Inhaltshöhe ziehen — der Brief soll nie scrollen.
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [sel, tab, shown?.brief]);

  // patch() bleibt der reine Lokal-State-Setter — für optimistisches Tippen in der
  // Textarea (jeder Tastendruck) und als letzter Schritt NACH einem erfolgreichen
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

  // Mehrfachaktion = dieselbe Route wie die Einzelaktion (POST /api/jobs/:id), n-mal.
  // Kein Sammel-Endpunkt: jeder Job ist eine eigene JSON-Datei (storage/json-store.ts),
  // serverseitig wäre das exakt dieselbe Schleife — nur an einer Stelle mehr, die den
  // Teilerfolg-Fall (k von n gespeichert) nochmal eigens beschreiben müsste.
  //
  // Pessimistisch wie move(): der lokale State wird erst nach der Antwort angefasst,
  // und nur für die Jobs, die wirklich durchkamen.
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

  // Fällige Nachfassen. Die Regel lebt in lib/followup.ts, damit sie testbar ist und
  // nicht zwischen Server und UI auseinanderdriftet.
  const faellig = useMemo(() => dueFollowUps(jobs), [jobs]);


  // Speichert erst beim Verlassen der Textarea (onBlur), nicht bei jedem Tastendruck —
  // blur feuert im Browser garantiert vor dem onClick eines anderen Listeneintrags
  // (mousedown blurred zuerst), also landet der letzte Stand immer beim richtigen
  // Job, auch bei schnellem Wechsel. Kein Debounce-Timer nötig, keine Race Condition.
  function saveBrief(id: string, text: string) {
    fetch(`/api/jobs/${id}/brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(r => { if (!r.ok) throw new Error(); say('Anschreiben gespeichert'); })
      .catch(() => say('Speichern fehlgeschlagen', 'err'));
  }

  // Die einzige Stelle, an der eine Empfängeradresse von Hand gesetzt wird. Vorher
  // konnte das nur die servergerenderte /job/:id/email-Form, die niemand mehr erreichte
  // (das UI verlinkt sie nicht) — nötig ist es trotzdem, weil findEmail() nicht immer
  // trifft und eine falsche Adresse sonst nicht zu korrigieren wäre.
  // Speichern beim Verlassen des Feldes, wie beim Anschreiben.
  function saveEmail(id: string, value: string) {
    const email = value.trim() || null;
    fetch(`/api/jobs/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
      .then(r => { if (!r.ok) throw new Error(); patch(id, { email }); say(email ? 'Adresse gespeichert' : 'Adresse entfernt'); })
      .catch(() => say('Speichern fehlgeschlagen', 'err'));
  }

  // Gmail-Tastatur: j/k wandern, e gibt frei, # löscht.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      const i = list.findIndex(j => j.id === sel);
      if (e.key === 'j' && i < list.length - 1) setSel(list[i + 1].id);
      else if (e.key === 'k' && i > 0) setSel(list[i - 1].id);
      else if (e.key === 'e' && shown?.status === 'generated') move(shown.id, 'freigegeben', 'Freigegeben');
      else if (e.key === '#' && shown && shown.status !== 'geloescht') move(shown.id, 'geloescht', 'Gelöscht');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list, sel, shown]);

  const open = (id: string) => {
    setSel(id);
    setDetailOpen(true);
  };

  // Schublade: Esc schliesst, Fokus wandert beim Oeffnen hinein und beim Schliessen
  // zurueck auf den Burger. Ohne das laesst eine Tastaturbedienung den Fokus hinter
  // dem Overlay stehen und man tabbt durch eine Liste, die man nicht sieht.
  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      burgerRef.current?.focus();
    };
  }, [drawerOpen]);

  // Startordner auf schmalen Schirmen: der erste nicht-leere. Ist gar nichts da, ist
  // der Scraper der einzige sinnvolle Ort (Kevin). Fest auf mail/entwurf zu starten
  // hiess auf dem Handy: leerer Bildschirm, und ohne Seitenleiste kein Weg heraus.
  // Laeuft genau einmal, sobald die Jobs geladen sind — danach entscheidet der Nutzer.
  const startGesetzt = useRef(false);
  useEffect(() => {
    if (startGesetzt.current || jobs.length === 0) return;
    startGesetzt.current = true;
    if (!window.matchMedia('(max-width:1023px)').matches) return;
    const ersterVoller = FOLDER_IDS.find(id => jobs.some(j => inFolder(j, id)));
    if (ersterVoller) setFolder(ersterVoller);
    else setView('scrape');
  }, [jobs]);

  // Grobe Summen-Fraktion über alle Quellen statt Fortschritt pro Quelle exakt zu
  // verrechnen (die "total"-Einheiten unterscheiden sich je Quelle) — reicht für
  // eine dekorative "es tut sich was"-Anzeige, siehe Grilling-Runde 1.
  const scrapeSourceEntries = scrapeStatus ? Object.entries(scrapeStatus.sources) : [];
  const scrapeCurrentSum = scrapeSourceEntries.reduce((a, [, v]) => a + v.current, 0);
  const scrapeTotalSum = scrapeSourceEntries.reduce((a, [, v]) => a + v.total, 0);
  const scrapePct = scrapeTotalSum > 0 ? Math.min(100, Math.round((scrapeCurrentSum / scrapeTotalSum) * 100)) : 0;
  const filterPct = filterStatus?.current && filterStatus.current.total > 0
    ? Math.round((filterStatus.current.i / filterStatus.current.total) * 100)
    : 0;
  // i ist der Index des GERADE laufenden Jobs (0-basiert, vor dessen Start gesetzt) —
  // i/total bliebe bei einem einzelnen Job die ganze Generierung über bei 0% (unsichtbarer
  // Balken). (i+1)/total zeigt sofort sichtbaren Fortschritt für den laufenden Job.
  const anschreibenPct = anschreibenStatus?.current && anschreibenStatus.current.total > 0
    ? Math.round(((anschreibenStatus.current.i + 1) / anschreibenStatus.current.total) * 100)
    : 0;

  // Spiegelt scripts/run-anschreiben.ts: status "triaged" + fit aus den angehakten
  // Kästchen, optional per Limit gekappt (gleiche Reihenfolge wie die Jobs-Liste,
  // kein eigenes Sortierkriterium).
  const anschreibenEligible = jobs.filter(j => j.status === 'triaged' && j.fit != null && anschreibenFits.has(j.fit));
  const anschreibenLimitN = Number(anschreibenLimit);
  const anschreibenSelection = anschreibenLimit && Number.isFinite(anschreibenLimitN) && anschreibenLimitN > 0
    ? anschreibenEligible.slice(0, anschreibenLimitN)
    : anschreibenEligible;

  return (
    <div className={'jb' + (detailOpen ? ' jb--detail' : '')}>
      <style>{CSS}</style>

      {/* Nur unter 1024 sichtbar (siehe .topbar im CSS). Traegt den einzigen Zugang zur
          Seitenleiste, sobald die zur Schublade wird — ohne ihn war die halbe App auf
          schmalen Schirmen unerreichbar. */}
      <div className="topbar">
        <button
          ref={burgerRef}
          className="topbar__burger"
          onClick={() => setDrawerOpen(true)}
          aria-label="Navigation öffnen"
          aria-expanded={drawerOpen}
        >
          <Menu />
        </button>
        <span className="topbar__wo">{view === 'jobs' ? (FOLDER_LABEL[folder] ?? 'Jobs') : (VIEW_LABEL[view] ?? 'Jobs')}</span>
        {view === 'jobs' && <span className="topbar__n">{list.length}</span>}
      </div>

      {drawerOpen && <div className="sb__overlay" onClick={() => setDrawerOpen(false)} />}

      {/* ---------- Sidebar ---------- */}
      {/* Ein Klick-Handler auf dem <nav> statt an jedem einzelnen Eintrag: die Leiste hat
          inzwischen 17 Knoepfe, und ein vergessener liesse die Schublade offen stehen. */}
      <nav
        ref={drawerRef}
        className={'sb' + (drawerOpen ? ' sb--offen' : '')}
        onClick={e => { if ((e.target as HTMLElement).closest('.fld')) setDrawerOpen(false); }}
      >
        <div className="sb__brand">
          <span className="sb__logo">
            <b>jobbot</b>
            <span> ://</span>
          </span>
          <span className="sb__ver">v0.4</span>
        </div>

        {GROUPS.map((g, gi) => (
          <React.Fragment key={g.head ?? 'root'}>
            {gi === 3 && <div className="sb__rule" />}
            <div className="sb__group">
              {g.head && (
                <div className="sb__head">
                  {g.icon && <g.icon />}
                  {g.head}
                </div>
              )}
              {g.folders.map(f => (
                <button
                  key={f.id}
                  className={
                    'fld' +
                    (folder === f.id ? ' fld--on' : '') +
                    (f.err ? ' fld--err' : '') +
                    (f.err && (counts[f.id] ?? 0) > 0 ? ' fld--has' : '')
                  }
                  onClick={() => {
                    setView('jobs');
                    setFolder(f.id);
                    setFit('alle');
                    if (highlightFolders.has(f.id)) {
                      setHighlightFolders(prev => {
                        const next = new Set(prev);
                        next.delete(f.id);
                        return next;
                      });
                    }
                  }}
                >
                  <f.icon />
                  <span className="fld__label">{f.label}</span>
                  {highlightFolders.has(f.id) && <span className="fld__dot" />}
                  <span className="fld__n">{counts[f.id] ?? 0}</span>
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}

        <div className="sb__rule" />
        <div className="sb__group">
          <button className={'fld' + (view === 'attachment' ? ' fld--on' : '')} onClick={() => setView('attachment')}>
            <Paperclip />
            <span className="fld__label">Anhang</span>
          </button>
          <button className={'fld' + (view === 'cc' ? ' fld--on' : '')} onClick={() => setView('cc')}>
            <Copy />
            <span className="fld__label">CC</span>
          </button>
          <button className={'fld' + (view === 'suche' ? ' fld--on' : '')} onClick={() => setView('suche')}>
            <Search />
            <span className="fld__label">Suche</span>
          </button>
          <button className={'fld' + (view === 'calendar' ? ' fld--on' : '')} onClick={() => setView('calendar')}>
            <Calendar />
            <span className="fld__label">Kalender</span>
          </button>
        </div>

        <div className="sb__rule" />
        <div className="sb__group">
          <div className="sb__head">Pipeline</div>
          <button className={'fld' + (view === 'scrape' ? ' fld--on' : '')} onClick={() => setView('scrape')}>
            <Download />
            <span className="fld__label">Scrape</span>
          </button>
          {scrapeStatus?.status === 'running' && (
            <div className="fld__bar">
              <span style={{ width: `${scrapePct}%` }} />
            </div>
          )}
          <button className={'fld' + (view === 'filter' ? ' fld--on' : '')} onClick={() => setView('filter')}>
            <FilterIcon />
            <span className="fld__label">Filter</span>
          </button>
          {filterStatus?.status === 'running' && (
            <div className="fld__bar">
              <span style={{ width: `${filterPct}%` }} />
            </div>
          )}
          <button className={'fld' + (view === 'duplicates' ? ' fld--on' : '')} onClick={() => setView('duplicates')}>
            <Layers />
            <span className="fld__label">Duplikate</span>
            {duplicateGroups && duplicateGroups.length > 0 && <span className="fld__n">{duplicateGroups.length}</span>}
          </button>
          <button className={'fld' + (view === 'anschreiben' ? ' fld--on' : '')} onClick={() => setView('anschreiben')}>
            <FileText />
            <span className="fld__label">Anschreiben</span>
          </button>
          <button className={'fld' + (view === 'nachfass' ? ' fld--on' : '')} onClick={() => setView('nachfass')}>
            <RotateCw />
            <span className="fld__label">Nachfassen</span>
            {faellig.length > 0 && <span className="fld__n">{faellig.length}</span>}
          </button>
          {anschreibenStatus?.status === 'running' && (
            <div className="fld__bar">
              <span style={{ width: `${anschreibenPct}%` }} />
            </div>
          )}
        </div>

        <div className="sb__keys">
          <div className="key">
            <span>Wandern</span>
            <span>
              <kbd>j</kbd> <kbd>k</kbd>
            </span>
          </div>
          <div className="key">
            <span>Freigeben</span>
            <kbd>e</kbd>
          </div>
          <div className="key">
            <span>Löschen</span>
            <kbd>#</kbd>
          </div>
        </div>
      </nav>

      {view === 'cc' ? (
        /* ---------- CC ---------- */
        <section className="att">
          <header className="dt__head">
            <div className="dt__firma">CC</div>
            <div className="dt__titel">Wird jedem Entwurf und jeder Direktversand-Mail automatisch als CC hinzugefügt.</div>
          </header>
          <div className="dt__body">
            {cc === undefined ? null : cc ? (
              <div className="paper" style={{ maxWidth: 420, padding: '18px 22px' }}>
                <div className="paper__to">
                  <span>{cc}</span>
                </div>
              </div>
            ) : (
              <div className="empty" style={{ textAlign: 'left', padding: '8px 0' }}>
                <div className="empty__h">Kein CC gesetzt</div>
                Adresse eintragen, damit jede Bewerbung automatisch eine Kopie mitschickt.
              </div>
            )}
            <form
              style={{ display: 'flex', gap: 8, marginTop: 16, maxWidth: 420 }}
              onSubmit={e => {
                e.preventDefault();
                const value = ccInput.trim();
                if (value) saveCcNow(value);
              }}
            >
              <input
                type="email"
                value={ccInput}
                onChange={e => setCcInput(e.target.value)}
                placeholder="cc@example.com"
                style={{
                  flex: 1, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 5,
                  color: 'var(--text)', font: 'inherit', padding: '6px 9px',
                }}
              />
              <button type="submit" className="btn btn--primary">Speichern</button>
            </form>
          </div>
          {cc && (
            <footer className="bar">
              <button className="btn btn--ghost btn--danger" onClick={removeCc}>
                <Trash2 /> Entfernen
              </button>
            </footer>
          )}
        </section>
      ) : view === 'calendar' ? (
        /* ---------- Kalender ---------- */
        <section className="cal">
          <header className="dt__head">
            <div className="cal__head-row">
              <div>
                <div className="dt__firma">Kalender</div>
                <div className="dt__titel">
                  Wann Bewerbungen rausgingen, wann nachgefasst wurde und wann Antworten zurückkamen.
                </div>
                {/* Ohne Legende ist der dreifarbige Verlauf im Tagesquadrat nicht lesbar. */}
                <div className="cal__legende">
                  {CAL_TYPES.map(t => (
                    <span key={t}>
                      <span className="cal__entry__dot" style={{ background: CAL_COLOR[t] }} />
                      {{ sent: 'gesendet', followup: 'nachgefasst', reply: 'Antwort' }[t]}
                    </span>
                  ))}
                </div>
              </div>
              {/* Sitzt hier statt in der Sidebar, weil der Sync genau das füllt, was
                  diese Ansicht anzeigt — ein leerer Kalender ist der Moment, in dem
                  man ihn sucht. */}
              <button
                className="btn btn--ghost"
                disabled={gmailSyncing}
                onClick={syncGmail}
                title="Liest Gesendet-Ordner und Inbox und trägt fehlende Daten nach. Ändert in Gmail nichts."
              >
                <Mail /> {gmailSyncing ? 'Synct…' : 'Gmail-Sync'}
              </button>
            </div>
          </header>
          <div className="cal__body">
            <CalendarView
              events={calendarEvents}
              onOpenJob={id => {
                setView('jobs');
                setFolder('log/gesendet');
                setFit('alle');
                open(id);
              }}
            />
          </div>
        </section>
      ) : view === 'attachment' ? (
        /* ---------- Anhang ---------- */
        <section className="att">
          <header className="dt__head">
            <div className="dt__firma">Anhang</div>
            <div className="dt__titel">Wird jedem Entwurf und jeder Direktversand-Mail automatisch angehängt.</div>
          </header>
          <div className="dt__body">
            {attachment === undefined ? null : attachment ? (
              <div className="paper" style={{ maxWidth: 420, padding: '18px 22px' }}>
                <div className="paper__to">
                  <span>{attachment.filename}</span>
                  <span>{Math.round(attachment.size / 1024)} KB</span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: '#9B9891' }}>
                  Hochgeladen am {new Date(attachment.uploadedAt).toLocaleDateString('de-DE')}
                </div>
              </div>
            ) : (
              <div className="empty" style={{ textAlign: 'left', padding: '8px 0' }}>
                <div className="empty__h">Kein Anhang</div>
                PDF hochladen, damit jede Bewerbung automatisch den Lebenslauf mitschickt.
              </div>
            )}

            <label
              className="dropzone"
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) uploadAttachment(f);
              }}
            >
              <input
                type="file"
                accept="application/pdf"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadAttachment(f);
                }}
              />
              PDF hierher ziehen oder klicken zum Auswählen
            </label>
          </div>
          {attachment && (
            <footer className="bar">
              <button className="btn btn--ghost btn--danger" onClick={removeAttachment}>
                <Trash2 /> Entfernen
              </button>
            </footer>
          )}
        </section>
      ) : view === 'scrape' ? (
        /* ---------- Scrape ---------- */
        <section className="att">
          <header className="dt__head">
            <div className="dt__firma">Scrape</div>
            <div className="dt__titel">Neue Jobs von den ausgewählten Quellen holen.</div>
          </header>
          <div className="dt__body">
            {scrapeStatus?.status === 'running' || scrapeSections.length > 0 ? (
              <LoadGridPanel
                running={scrapeStatus?.status === 'running'}
                sections={scrapeSections}
                onClose={() => {
                  setScrapeSections([]);
                  // Mit dem Grid gehen auch Tschobbos Klumpen (ui/tschobbo.js) —
                  // sonst bliebe der Haufen ohne Grid im Bild stehen.
                  window.dispatchEvent(new CustomEvent('tschobbo:view', { detail: { active: false } }));
                }}
                ghost
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxWidth: 420 }}>
                {scrapeSources.map(name => (
                  <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={selectedSources.has(name)}
                      onChange={e => setSelectedSources(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(name); else next.delete(name);
                        return next;
                      })}
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <footer className="bar">
            <button
              className="btn btn--primary"
              disabled={scrapeStarting || scrapeStatus?.status === 'running' || selectedSources.size === 0}
              onClick={runScrapeNow}
            >
              <Play /> Scrapen
            </button>
          </footer>
        </section>
      ) : view === 'filter' ? (
        /* ---------- Filter ---------- */
        <section className="att">
          <header className="dt__head">
            <div className="dt__firma">Filter</div>
            <div className="dt__titel">
              {filterScope === 'all' ? 'Alle Jobs neu triagen.' : 'Jobs mit Status "neu" filtern.'}
            </div>
          </header>
          <div className="dt__body">
            {filterStatus?.status === 'running' || filterSections.length > 0 ? (
              <LoadGridPanel
                running={filterStatus?.status === 'running'}
                sections={filterSections}
                onClose={() => setFilterSections([])}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="modetoggle">
                  {(['regex', 'llm'] as const).map(m => (
                    <button key={m} className={'modebtn' + (filterMode === m ? ' modebtn--on' : '')} onClick={() => setFilterMode(m)}>
                      {m === 'regex' ? 'Regex' : 'LLM'}
                    </button>
                  ))}
                </div>
                <div className="modetoggle">
                  {(['new', 'all'] as const).map(s => (
                    <button key={s} className={'modebtn' + (filterScope === s ? ' modebtn--on' : '')} onClick={() => setFilterScope(s)}>
                      {s === 'new' ? 'Nur neue' : 'Alle Jobs'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <footer className="bar">
            <button
              className="btn btn--primary"
              disabled={filterStarting || filterStatus?.status === 'running'}
              onClick={runFilterNow}
            >
              <Play /> Filtern
            </button>
          </footer>
        </section>
      ) : view === 'duplicates' ? (
        /* ---------- Duplikate ---------- */
        <section className="att">
          <header className="dt__head">
            <div className="dt__firma">Duplikate</div>
            <div className="dt__titel">
              Jobs, die nach Normalisierung (Klein­schreibung, Gender­marker, Rechtsform) auf dieselbe ID
              zusammenfallen. Zusammenführen behält das neueste Inserat je Gruppe, übernimmt aber
              das erste Pull-Datum der älteren — die älteren Dateien werden dabei gelöscht.
            </div>
          </header>
          <div className="dt__body">
            {duplicatesLoading ? (
              <div className="empty" style={{ textAlign: 'left', padding: '8px 0' }}>
                <div className="empty__h">Lädt…</div>
              </div>
            ) : !duplicateGroups || duplicateGroups.length === 0 ? (
              <div className="empty" style={{ textAlign: 'left', padding: '8px 0' }}>
                <div className="empty__h">Keine Duplikate gefunden.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {duplicateGroups.map(g => {
                  const newestIndex = g.jobs.length - 1;
                  return (
                    <div key={g.key}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                        <input
                          type="checkbox"
                          checked={selectedDupKeys.has(g.key)}
                          onChange={e => setSelectedDupKeys(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(g.key); else next.delete(g.key);
                            return next;
                          })}
                        />
                        {g.jobs[0].title} — {g.jobs[0].company}
                        <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({g.jobs.length}×)</span>
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 22 }}>
                        {g.jobs.map((job, i) => (
                          // Index statt job.id als key/Vergleich: ein echter Re-Scrape derselben
                          // Stelle trägt in beiden Dateien dieselbe id (siehe lib/duplicates.ts
                          // planMerge) — job.id === newestId hätte hier fälschlich beide markiert.
                          <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--muted)' }}>
                            {job.scrapedAt.slice(0, 10)} · {job.status} ·{' '}
                            <a className="dup-lnk" href={job.url} target="_blank" rel="noreferrer">{job.url}</a>
                            {i === newestIndex
                              ? <span style={{ color: 'var(--ok)' }}> — bleibt (bekommt {g.jobs[0].scrapedAt.slice(0, 10)} als Pull-Datum)</span>
                              : <span style={{ color: 'var(--err)' }}> — wird gelöscht</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <footer className="bar">
            <button className="btn btn--primary" disabled={duplicatesLoading} onClick={loadDuplicates}>
              <RotateCw /> Neu prüfen
            </button>
            <span className="bar__spacer" />
            <button
              className="btn"
              disabled={merging || selectedDupKeys.size === 0}
              onClick={() => mergeDuplicates([...selectedDupKeys])}
            >
              Ausgewählte zusammenführen ({selectedDupKeys.size})
            </button>
            <button
              className="btn btn--primary"
              disabled={merging || !duplicateGroups || duplicateGroups.length === 0}
              onClick={() => mergeDuplicates('all')}
            >
              Alle zusammenführen
            </button>
          </footer>
        </section>
      ) : view === 'suche' ? (
        /* ---------- Suche: Suchgebiet + Umkreis ---------- */
        <section className="att">
          <header className="dt__head">
            <div className="dt__firma">Suche</div>
            <div className="dt__titel">
              Was gesucht wird und was davon übrig bleibt. Beides wirkt sofort — beide Dateien
              werden bei jedem Lauf frisch gelesen, ein Neustart ist nicht nötig.
            </div>
          </header>
          <div className="dt__body">
            {!sources || !umkreis || !schema ? (
              <div className="empty"><div className="empty__h">Lädt…</div></div>
            ) : (
              <div className="cfg">
                {cfgErrors.length > 0 && (
                  <div className="errbox">
                    <div className="errbox__h"><AlertTriangle /> Nicht gespeichert</div>
                    <div className="errbox__msg">{cfgErrors.map((e, i) => <div key={i}>{e}</div>)}</div>
                  </div>
                )}

                {/* Anfragen aus Handedits, die kein Adapter annehmen würde. Der Hinweis
                    steht hier, weil man sie hier auch loswird. */}
                {kaputteAnfragen.length > 0 && (
                  <div className="cfg__kaputt">
                    <b>
                      {kaputteAnfragen.length} Anfrage{kaputteAnfragen.length > 1 ? 'n' : ''} unbrauchbar — solange
                      das so ist, lässt sich das Suchgebiet nicht speichern
                    </b>
                    {kaputteAnfragen.map((k, i) => (
                      <div key={i} className="cfg__kaputt-zeile">
                        <span>{k.portal}, Anfrage {k.index + 1}: {k.problem}</span>
                        {k.fix && (
                          <button className="btn" onClick={() => repariereAnfrage(k.portal, k.index, k.fix!.von, k.fix!.nach)}>
                            „{k.fix.von}" → „{k.fix.nach}"
                          </button>
                        )}
                        <button className="btn btn--ghost btn--danger" onClick={() => {
                          setSources(prev => prev && ({
                            ...prev,
                            [k.portal]: { ...prev[k.portal], queries: prev[k.portal].queries.filter((_, qi) => qi !== k.index) },
                          }));
                          setCfgDirty(d => ({ ...d, sources: true }));
                        }}>Entfernen</button>
                      </div>
                    ))}
                  </div>
                )}

                <section className="cfg__block">
                  <h3 className="cfg__h">Suchgebiet <span>geht an das Portal</span></h3>
                  {Object.keys(schema).map(name => {
                    const cfg = sources[name] ?? { enabled: false, queries: [] };
                    return (
                      <PortalBlock
                        key={name} name={name} cfg={cfg} felder={schema[name]}
                        onChange={next => { setSources({ ...sources, [name]: next }); setCfgDirty(d => ({ ...d, sources: true })); }}
                      />
                    );
                  })}
                  {/* Verwaiste Einträge: in der Datei, aber ohne Adapter. Angezeigt statt
                      angeboten — die Registry sagt, welche Portale es gibt. */}
                  {Object.keys(sources).filter(n => !schema[n]).map(n => (
                    <div key={n} className="cfg__verwaist">
                      „{n}" steht in der Datei, es gibt aber kein Portal dieses Namens — wird ignoriert.
                      <button className="btn btn--ghost btn--danger" onClick={() => {
                        const { [n]: _weg, ...rest } = sources;
                        setSources(rest); setCfgDirty(d => ({ ...d, sources: true }));
                      }}>Entfernen</button>
                    </div>
                  ))}
                  <RohAnsicht offen={!!rohOffen.sources} onToggle={() => setRohOffen(o => ({ ...o, sources: !o.sources }))} data={sources} />
                  <div className="cfg__leiste">
                    <button
                      className="btn btn--primary"
                      disabled={cfgBusy || !cfgDirty.sources || sourcesFehlerhaft}
                      title={sourcesFehlerhaft ? 'Erst die unbrauchbaren Anfragen oben beheben' : undefined}
                      onClick={() => saveConfig('sources')}
                    >
                      Speichern
                    </button>
                    {cfgBackup.sources && (
                      <button className="btn btn--ghost" disabled={cfgBusy} onClick={() => restoreConfig('sources')}>
                        <Undo2 /> Letzte Fassung zurückholen
                      </button>
                    )}
                  </div>
                </section>

                <section className="cfg__block">
                  <h3 className="cfg__h">Umkreis <span>wirft nach dem Scrapen weg</span></h3>
                  <p className="cfg__erklaerung">
                    Gilt für alle Quellen, auch für die, die österreichweit suchen. Geprüft wird gegen
                    alle Begriffe zusammen — die Gruppen ordnen nur.
                  </p>
                  {UMKREIS_GRUPPEN.map(g => (
                    <div key={g.key} className="cfg__gruppe">
                      <span className="cfg__gruppe-name">{g.label}</span>
                      <ChipListe
                        werte={umkreis[g.key]}
                        hint={`+ ${g.hint}`}
                        warnung={g.key === 'regions'
                          ? (w) => istLandesbegriff(w)
                            ? `„${w}" als Region behielte jeden Job, dessen Ort auf „…, ${w}" endet — also praktisch alle. Der Umkreisfilter wäre damit aus.`
                            : null
                          : undefined}
                        onChange={next => { setUmkreis({ ...umkreis, [g.key]: next }); setCfgDirty(d => ({ ...d, location: true })); }}
                      />
                    </div>
                  ))}
                  <RohAnsicht offen={!!rohOffen.location} onToggle={() => setRohOffen(o => ({ ...o, location: !o.location }))} data={umkreis} />
                  <div className="cfg__leiste">
                    <button className="btn btn--primary" disabled={cfgBusy || !cfgDirty.location} onClick={() => saveConfig('location')}>
                      Speichern
                    </button>
                    {cfgBackup.location && (
                      <button className="btn btn--ghost" disabled={cfgBusy} onClick={() => restoreConfig('location')}>
                        <Undo2 /> Letzte Fassung zurückholen
                      </button>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </section>
      ) : view === 'nachfass' ? (
        /* ---------- Nachfassen ---------- */
        <section className="att">
          <header className="dt__head">
            <div className="dt__firma">Nachfassen</div>
            <div className="dt__titel">
              Bewerbungen ohne Rückmeldung seit mindestens {FOLLOW_UP_DAYS} Tagen. Die Uhr läuft ab dem letzten
              Kontakt, ein Nachfass setzt sie zurück — es bleibt fällig, bis eine Antwort da ist.
            </div>
          </header>
          <div className="dt__body">
            {faellig.length === 0 ? (
              <div className="empty">
                <div className="empty__h">Nichts offen</div>
                Keine Bewerbung wartet länger als {FOLLOW_UP_DAYS} Tage auf eine Antwort.
              </div>
            ) : (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 0 10px', fontSize: 12, color: 'var(--muted)' }}>
                  <input
                    type="checkbox"
                    className="row__check"
                    style={{ marginLeft: 0 }}
                    checked={faellig.every(j => followUpSelection.has(j.id))}
                    onChange={e => setFollowUpSelection(e.target.checked ? new Set(faellig.map(j => j.id)) : new Set())}
                  />
                  Alle auswählen ({faellig.length})
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {faellig.map(j => {
                    const tage = daysSinceLastContact(j) ?? 0;
                    const versuche = j.followUps?.length ?? 0;
                    return (
                      <label key={j.id} className="nf__row">
                        <input
                          type="checkbox"
                          className="row__check"
                          style={{ marginLeft: 0 }}
                          checked={followUpSelection.has(j.id)}
                          onChange={() => setFollowUpSelection(prev => {
                            const next = new Set(prev);
                            if (next.has(j.id)) next.delete(j.id); else next.add(j.id);
                            return next;
                          })}
                        />
                        <span className="nf__firma">{j.company}</span>
                        <span className="nf__titel">{j.title}</span>
                        <span className="nf__meta">
                          <span className="tag">{j.email}</span>
                          {versuche > 0 && <span className="tag">{versuche}× nachgefasst</span>}
                          <span className="row__age">{tage}d</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {/* Knöpfe links wie in den anderen Views: der Tschobbo-Schalter klebt fix unten
              rechts (z-index 41) und läge sonst genau auf "Senden". */}
          <footer className="bar">
            <button
              className="btn"
              disabled={followUpBusy || followUpSelection.size === 0}
              onClick={() => runFollowUps('draft')}
            >
              <FileText /> Als Entwurf ({followUpSelection.size})
            </button>
            <button
              className="btn btn--primary"
              disabled={followUpBusy || followUpSelection.size === 0}
              onClick={() => runFollowUps('sent')}
            >
              <Send /> Senden ({followUpSelection.size})
            </button>
            <span className="bar__spacer" />
            <span className="bar__hint">
              {followUpBusy ? 'läuft…' : `${followUpSelection.size} von ${faellig.length} ausgewählt`}
            </span>
          </footer>
        </section>
      ) : view === 'anschreiben' ? (
        /* ---------- Anschreiben ---------- */
        <section className="att">
          <header className="dt__head">
            <div className="dt__firma">Anschreiben</div>
            <div className="dt__titel">Anschreiben für getriagte Jobs generieren — wie scripts/run-anschreiben.ts.</div>
          </header>
          <div className="dt__body">
            {anschreibenStatus?.status === 'running' || anschreibenSections.length > 0 ? (
              <LoadGridPanel
                running={anschreibenStatus?.status === 'running'}
                sections={anschreibenSections}
                onClose={() => setAnschreibenSections([])}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 420 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={anschreibenFits.size === 3}
                      onChange={e => setAnschreibenFits(e.target.checked ? new Set(['matched', 'offstack', 'brutal']) : new Set())}
                    />
                    Alle
                  </label>
                  {(['matched', 'offstack', 'brutal'] as const).map(f => (
                    <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, paddingLeft: 18 }}>
                      <input
                        type="checkbox"
                        checked={anschreibenFits.has(f)}
                        onChange={e => setAnschreibenFits(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(f); else next.delete(f);
                          return next;
                        })}
                      />
                      <span className="chip__dot" style={{ background: FIT[f].color }} />
                      {FIT[f].label}
                    </label>
                  ))}
                </div>
                {anschreibenFits.has('brutal') && (
                  <div style={{ fontSize: 11.5, color: 'var(--dim)' }}>
                    Brutal wird vom Lauf immer übersprungen (fit "brutal" ist grundsätzlich ungeeignet).
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  Limit
                  <input
                    type="number"
                    min={1}
                    value={anschreibenLimit}
                    onChange={e => setAnschreibenLimit(e.target.value)}
                    placeholder="alle"
                    style={{
                      width: 70, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 5,
                      color: 'var(--text)', font: 'inherit', padding: '3px 7px',
                    }}
                  />
                </label>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--dim)' }}>
                  {anschreibenSelection.length} von {anschreibenEligible.length} passenden Jobs ausgewählt
                </div>
              </div>
            )}
          </div>
          <footer className="bar">
            {anschreibenStatus?.status === 'running' ? (
              <button className="btn btn--danger" onClick={stopAnschreibenNow}>
                <Square /> Abbrechen
              </button>
            ) : (
              <button
                className="btn btn--primary"
                disabled={anschreibenStarting || anschreibenSelection.length === 0}
                onClick={() => runAnschreibenNow(anschreibenSelection.map(j => j.id))}
              >
                <Play /> Anschreiben erstellen
              </button>
            )}
          </footer>
        </section>
      ) : (
        <>
      {/* ---------- Liste ---------- */}
      <section className="ls">
        <div className="ls__top">
          <div className="srch">
            <Search />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Firma, Titel, Ort"
              aria-label="Suchen"
            />
          </div>
          <div className="chips" role="group" aria-label="Nach Fit filtern">
            {(['alle', 'matched', 'offstack', 'brutal', 'unbewertet'] as const).map(k => (
              <button key={k} className={'chip' + (fit === k ? ' chip--on' : '')} onClick={() => setFit(k)}>
                {k !== 'alle' && <span className="chip__dot" style={{ background: k === 'unbewertet' ? 'var(--line)' : FIT[k].color }} />}
                {k === 'alle' ? 'Alle' : k === 'unbewertet' ? 'Unbewertet' : FIT[k].label}
                <span className="chip__n">{fitCounts[k]}</span>
              </button>
            ))}
          </div>
          {folder === 'log/gesendet' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0 4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                <input type="checkbox" checked={replyOnly} onChange={e => setReplyOnly(e.target.checked)} />
                Nur mit Antwort
              </label>
              <button className="btn btn--ghost" disabled={repliesFetching} onClick={fetchReplies}>
                <Mail /> {repliesFetching ? 'Prüft…' : 'Antworten abrufen'}
              </button>
            </div>
          )}
          {selectable.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 0 4px', fontSize: 12, color: 'var(--muted)' }}>
              <input
                type="checkbox"
                className="row__check"
                style={{ marginLeft: 0 }}
                checked={selectable.every(j => selectedJobIds.has(j.id))}
                onChange={e => setSelectedJobIds(e.target.checked ? new Set(selectable.map(j => j.id)) : new Set())}
              />
              Alle sichtbaren auswählen ({selectable.length})
            </label>
          )}
        </div>

        {/* Auswahl-Leiste, in jedem Ordner. Die Aktionen unterscheiden sich nicht nach
            Ordner, sondern nach dem, was der einzelne Job hergibt: Anschreiben nur für
            getriagte, nicht-brutale Jobs (briefbar), alles andere für jede Auswahl.
            Die beiden Menüs sind native <select> — ein Klick, Tastatur inklusive, und
            kein eigener Dropdown-Zustand, der offen bleiben könnte. */}
        {selectedJobIds.size > 0 && (
          <div className="selbar">
            <span className="selbar__n">{selectedJobIds.size} ausgewählt</span>

            <select
              className="btn selbar__menu"
              value=""
              aria-label="Auswahl verschieben nach"
              onChange={e => {
                const t = e.target.value as MoveTarget | '';
                if (t) runBulk(MOVE_PATCH[t], `nach ${MOVE_TARGETS.find(m => m.value === t)!.label} verschoben`);
              }}
            >
              <option value="">Verschieben …</option>
              {MOVE_TARGETS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            <select
              className="btn selbar__menu"
              value=""
              aria-label="Urteil für Auswahl setzen"
              onChange={e => {
                const f = e.target.value as Fit | '';
                if (f) runBulk(() => ({ fit: f }), `auf ${FIT[f].label} gesetzt`);
              }}
            >
              <option value="">Urteil …</option>
              {(Object.keys(FIT) as Fit[]).map(f => (
                <option key={f} value={f}>{FIT[f].label}</option>
              ))}
            </select>

            <button
              className="btn btn--ghost btn--danger"
              onClick={() => runBulk(MOVE_PATCH.geloescht, 'gelöscht')}
            >
              <Trash2 /> Löschen
            </button>

            <button
              className="btn btn--primary"
              disabled={briefbar.length === 0 || anschreibenStarting || anschreibenStatus?.status === 'running'}
              title={
                briefbar.length === selectedJobIds.size
                  ? undefined
                  : `Nur ${briefbar.length} der ${selectedJobIds.size} sind getriagt und nicht brutal — erst den Filter laufen lassen`
              }
              onClick={() => runAnschreibenNow(briefbar)}
            >
              <FileText /> Anschreiben ({briefbar.length})
            </button>

            <button className="btn btn--ghost" onClick={() => setSelectedJobIds(new Set())}>
              <XCircle /> Aufheben
            </button>
          </div>
        )}

        <div className="ls__scroll">
          {list.length === 0 ? (
            <div className="empty">
              <div className="empty__h">Nichts hier</div>
              {q ? 'Suche anpassen oder Filter zurücksetzen.' : EMPTY_COPY[folder]}
            </div>
          ) : (
            list.map(j => (
              <div key={j.id} className="row-wrap">
                <input
                  type="checkbox"
                  className="row__check"
                  disabled={j.status === 'gesendet'}
                  checked={selectedJobIds.has(j.id)}
                  onChange={() => toggleSelect(j.id)}
                  onClick={e => e.stopPropagation()}
                  title={j.status === 'gesendet' ? 'Gesendet — schreibgeschützt' : undefined}
                  aria-label={
                    j.status === 'gesendet'
                      ? `${j.title} — gesendet, schreibgeschützt`
                      : `${j.title} auswählen`
                  }
                />
                <button
                  className={'row' + (sel === j.id ? ' row--on' : '') + (j.fit === 'brutal' ? ' row--dim' : '')}
                  onClick={() => open(j.id)}
                >
                  <span className="rail" style={{ background: fitColor(j.fit) }} />
                  <span className="row__l1">
                    <span className="row__firma">{j.company}</span>
                    <span className="row__age">{daysAgo(j.scrapedAt)}d</span>
                  </span>
                  <span className="row__titel">{j.title}</span>
                  <span className="row__snip">{j.status === 'fehler' ? (j.error ?? '').split('\n')[0] : firstLine(j.brief)}</span>
                  <span className="row__meta">
                    <span className={'tag' + (j.email ? '' : ' tag--nomail')}>{j.email ? 'MAIL' : 'PORTAL'}</span>
                    <span className="tag">{j.source}</span>
                    {j.status === 'fehler' && <span className="tag tag--err">FEHLER</span>}
                    {j.status === 'new' && <span className="tag tag--roh">UNGEFILTERT</span>}
                    {j.replyReceivedAt && <span className="tag tag--reply">ANTWORT ERHALTEN</span>}
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ---------- Detail ---------- */}
      <section className="dt">
        {!shown ? (
          <div className="empty" style={{ margin: 'auto' }}>
            <div className="empty__h">Kein Eintrag gewählt</div>
            Links etwas auswählen — oder mit <kbd>j</kbd> durchwandern.
          </div>
        ) : (
          <>
            <button className="dt__back" onClick={() => setDetailOpen(false)}>
              <ChevronLeft /> Liste
            </button>

            <header className="dt__head">
              <div className="dt__firma">{shown.company}</div>
              <div className="dt__titel">{shown.title}</div>
              <div className="dt__meta">
                <span>{shown.location ?? '—'}</span>
                <span className="dt__sep">·</span>
                <a className="lnk" href={shown.url} target="_blank" rel="noreferrer">
                  {shown.source} <ExternalLink />
                </a>
                <span className="dt__sep">·</span>
                <span>vor {daysAgo(shown.scrapedAt)} Tagen</span>
                <span className="dt__sep">·</span>
                <input
                  className="dt__mailin"
                  type="email"
                  value={shown.email ?? ''}
                  placeholder="Keine Adresse — übers Portal, oder hier eintragen"
                  aria-label="E-Mail-Adresse des Empfängers"
                  onChange={e => patch(shown.id, { email: e.target.value })}
                  onBlur={e => saveEmail(shown.id, e.target.value)}
                />
              </div>

              <div className="fitpick">
                <span className="fitpick__lbl">Fit</span>
                {Object.entries(FIT).map(([k, v]) => (
                  <button
                    key={k}
                    className={'fitbtn' + (shown.fit === k ? ' fitbtn--on' : '')}
                    style={shown.fit === k ? { background: v.color + '1F', color: v.color } : undefined}
                    onClick={() => saveFit(shown.id, k as Fit)}
                  >
                    <span className="chip__dot" style={{ background: v.color }} />
                    {v.label}
                  </button>
                ))}
              </div>
            </header>

            <div className="tabs">
              <button className={'tab' + (tab === 'brief' ? ' tab--on' : '')} onClick={() => setTab('brief')}>
                Anschreiben
              </button>
              <button className={'tab' + (tab === 'inserat' ? ' tab--on' : '')} onClick={() => setTab('inserat')}>
                Inserat
              </button>
            </div>

            <div className="dt__body">
              {shown.status === 'fehler' && (
                <div className="errbox">
                  <div className="errbox__h">
                    <AlertTriangle /> Lauf abgebrochen
                  </div>
                  <div className="errbox__msg" style={{ whiteSpace: 'pre-wrap' }}>
                    {shown.error ?? '(keine Fehlermeldung gespeichert)'}
                  </div>
                </div>
              )}

              {/* Beide Bereiche sind immer im DOM; welcher zu sehen ist, entscheidet CSS.
                  Unter 2000px blendet die Tab-Klasse den inaktiven aus, darüber stehen sie
                  nebeneinander (Band C) — so bleibt der Umschalt-Zustand eine reine
                  Darstellungsfrage und braucht keinen zweiten React-Zweig. */}
              <div className={'dt__panels dt__panels--' + tab}>
              <div className="dt__panel dt__panel--brief">
              {(
                shown.brief ? (
                  <div className="paper">
                    <div className="paper__to">
                      <span>An: {shown.email || '— Portal —'}</span>
                      <span>Betreff: Bewerbung {shown.title}</span>
                    </div>
                    <textarea
                      ref={ta}
                      className="paper__ta"
                      value={shown.brief}
                      onChange={e => patch(shown.id, { brief: e.target.value })}
                      onBlur={e => saveBrief(shown.id, e.target.value)}
                      spellCheck
                      aria-label="Anschreiben bearbeiten"
                    />
                    <div className="paper__foot">
                      <span>{shown.brief.trim().split(/\s+/).length} Wörter</span>
                      <span>Änderungen werden übernommen</span>
                    </div>
                  </div>
                ) : (
                  <div className="empty" style={{ textAlign: 'left', padding: '8px 0' }}>
                    <div className="empty__h">Kein Anschreiben</div>
                    {/* Ungefilterte Jobs hatten nie einen Lauf — "abgebrochen" wäre gelogen
                        und schickt beim Suchen nach dem Fehler in die falsche Richtung. */}
                    {shown.status === 'new'
                      ? 'Noch nicht gefiltert — erst den Filter über diesen Job laufen lassen, danach ist ein Anschreiben möglich.'
                      : 'Der Lauf ist vor der Generierung abgebrochen. Fehler oben beheben, dann neu generieren.'}
                  </div>
                )
              )}
              </div>
              <div className="dt__panel dt__panel--inserat">
                <div className="inserat">
                  <h4>Inserat · {shown.source}</h4>
                  {decodeEntities(shown.description)}
                </div>
              </div>
              </div>
            </div>

            <footer className="bar">
              {shown.status === 'generated' && (
                <button className="btn btn--primary" onClick={() => move(shown.id, 'freigegeben', 'Freigegeben')}>
                  <CheckCircle2 /> Freigeben
                </button>
              )}
              {shown.status === 'freigegeben' &&
                (shown.email ? (
                  <>
                    <button className="btn btn--primary" onClick={() => createDraft(shown.id, shown.email!)}>
                      <Send /> Entwurf erzeugen
                    </button>
                    <button className="btn" onClick={() => sendDirect(shown.id)}>
                      <Send /> Direkt senden
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn--primary" onClick={() => window.open(shown.url, '_blank')}>
                      <ExternalLink /> Portal öffnen
                    </button>
                    <button className="btn" onClick={() => move(shown.id, 'gesendet', 'Als beworben markiert')}>
                      <CheckCircle2 /> Als beworben markieren
                    </button>
                  </>
                ))}
              {shown.status === 'postausgang' && (
                <button className="btn btn--primary" onClick={() => move(shown.id, 'gesendet', 'Als gesendet bestätigt')}>
                  <Send /> Als gesendet bestätigen
                </button>
              )}
              {(shown.status === 'geloescht' || shown.status === 'fehler') && (
                <button className="btn" onClick={() => move(shown.id, 'generated', 'Zurück in Entwürfe')}>
                  <Undo2 /> Wiederherstellen
                </button>
              )}
              {shown.status !== 'gesendet' && (
                <button
                  className="btn btn--ghost"
                  disabled={anschreibenStarting || anschreibenStatus?.status === 'running'}
                  onClick={() => regenerate(shown)}
                >
                  <RotateCw /> Neu generieren
                </button>
              )}

              <span className="bar__spacer" />

              {shown.status === 'gesendet' ? (
                <span className="bar__hint">gesendet · schreibgeschützt</span>
              ) : (
                shown.status !== 'geloescht' && (
                  <button className="btn btn--ghost btn--danger" onClick={() => move(shown.id, 'geloescht', 'Gelöscht')}>
                    <Trash2 /> Löschen
                  </button>
                )
              )}
            </footer>
          </>
        )}
      </section>
        </>
      )}

      {toast && (
        <div className="toaststack">
          <div className={`toast toast--${toast.kind}`}>
            {toast.kind === 'ok' ? <CheckCircle2 /> : <XCircle />}
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<JobbotUI />);
