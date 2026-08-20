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
} from 'lucide-react';
import type { Job, Fit } from '../scrapers/interface.ts';
import { FOLDER_IDS, inFolder, canGenerateAnschreiben, type FolderId } from '../lib/folders.ts';
import { HISTORY_START, monthsDescending } from '../lib/calendar.ts';
import { FOLLOW_UP_DAYS, dueFollowUps, daysSinceLastContact } from '../lib/followup.ts';
import { COUNTRY_ONLY } from '../lib/location-terms.ts';
// Dieselbe Funktion, die der Server vor dem Schreiben laufen lässt (lib/config-store.ts)
// und die die Adapter beim Scrapen benutzen. lib/query-schema.ts importiert nur Typen,
// darf also ins Bundle — so gibt es die Regeln genau einmal, statt einmal hier
// nachgebaut und einmal dort.
import { checkQuery, describeProblem } from '../lib/query-schema.ts';
import type { QueryField } from '../scrapers/interface.ts';

// /api/jobs joint das Anschreiben serverseitig dazu (siehe scripts/ui-server.ts) —
// es lebt in data/anschreiben/{slug}.md, nicht im Job-JSON. Deshalb ist `brief` hier
// und nicht auf dem Job-Typ selbst: ein Feld, das nur diese Antwort hat, kein Feld,
// das je zurückgeschrieben wird (Speichern einer Bearbeitung ist ein eigener Endpunkt).
type JobWithBrief = Job & { brief: string | null };
type AttachmentMeta = { filename: string; size: number; uploadedAt: string };

// Spiegeln die Server-Shapes aus scripts/ui-server.ts (ScrapeRunState/FilterRunState)
// — kein gemeinsames Typ-Modul, weil der Server sonst Browser-untaugliche Imports
// (node:fs via lib/settings.ts etc.) ins UI-Bundle ziehen würde.
type ScrapeStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  runId: string | null;
  sources: Record<string, { current: number; total: number }>;
  result?: { newTotal: number; skipTotal: number; perSource: { name: string; ok: boolean; newCount: number; skipCount: number; error?: string }[] };
  error?: string;
};
type FilterRunStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  runId: string | null;
  current?: { i: number; total: number; title: string };
  result?: { matched: number; offstack: number; brutal: number };
  error?: string;
};
type AnschreibenRunStatus = {
  status: 'idle' | 'running' | 'done' | 'error' | 'stopped';
  runId: string | null;
  current?: { i: number; total: number; title: string };
  result?: { generated: number; skipped: number; emailsFound: number; mailGenerated: number; nomailGenerated: number };
  error?: string;
};
// Spiegelt GridUnitEvent aus scripts/ui-server.ts — ein SSE-Event pro abgeschlossener
// Grid-Zeile (Seite/Batch/Anschreiben-Item), siehe LoadGrid weiter unten.
type GridUnitEvent = { section: string; sectionLabel: string; row: string; items: LoadGridSquare[] };
type FilterMode = 'llm' | 'regex';
// Spiegelt lib/duplicates.ts DuplicateGroup — kein gemeinsames Modul aus demselben
// Grund wie oben (Job-Typ selbst kommt weiterhin aus scrapers/interface.ts).
type DuplicateGroup = { key: string; jobs: Job[] };
// Spiegelt die Ereignisliste von GET /api/calendar (scripts/ui-server.ts) — ein Eintrag
// je gesetztem sentAt/replyReceivedAt, date als 'YYYY-MM-DD'. jobId ist null bei
// gelabelten Bewerbungs-Mails, zu denen es keinen Job (mehr) gibt: die kommen aus
// data/mail-events.json und haben nichts, wohin man springen könnte.
// Spiegelt lib/sources.ts bzw. lib/location.ts — kein gemeinsames Modul, weil beide
// readFileSync benutzen und nicht ins Browser-Bundle dürfen (siehe lib/location-terms.ts).
type SourcesCfg = Record<string, { enabled: boolean; queries: Record<string, string>[] }>;
type LocationCfg = { cities: string[]; regions: string[]; remote: string[] };

const UMKREIS_GRUPPEN: { key: keyof LocationCfg; label: string; hint: string }[] = [
  { key: 'cities', label: 'Orte', hint: 'Ort hinzufügen' },
  { key: 'regions', label: 'Regionen', hint: 'Region hinzufügen' },
  { key: 'remote', label: 'Zählt als „remote"', hint: 'Begriff hinzufügen' },
];

// Die eine Eingabe, die still das ganze Verhalten umdreht: COUNTRY_ONLY wird in
// isInRange() EXAKT verglichen, eine Region dagegen per Substring. "Österreich" als
// Region behält damit jeden Job mit "…, Österreich" — der Umkreisfilter ist praktisch
// aus. Gewarnt, nicht verboten: wer wirklich alles will, darf das.
function istLandesbegriff(wert: string): boolean {
  return COUNTRY_ONLY.includes(wert.trim().toLowerCase());
}

type CalendarEvent = { date: string; type: 'sent' | 'reply' | 'followup'; jobId: string | null; title: string; company: string };

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

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&display=swap');

.jb *, .jb *::before, .jb *::after { box-sizing: border-box; }
.jb {
  --ink:#0E1116; --slate:#141821; --panel:#1B212B; --raised:#222A36;
  --line:#2A323F; --line-soft:#212936;
  --text:#E6EAF0; --muted:#8A94A6; --dim:#5E6878;
  --paper:#F3F2EE; --paper-ink:#191C22; --paper-line:#DAD8D1;
  --err:#E5484D; --ok:#35D0A5;
  --fit-matched:#5B8CFF; --fit-offstack:#E8B04B; --fit-brutal:#E8622A;
  --sans:'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --mono:'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;
  --serif:'IBM Plex Serif', Georgia, serif;

  position:fixed; inset:0;
  /* Band B: stetig statt in Stufen. Die alte 1180er-Stufe (236/372 -> 208/320) sprang
     sichtbar, und bei 1024px blieben der Detailspalte nur 496px — schmaler als das
     Anschreiben selbst (.paper, max-width:660px). minmax(0,1fr) statt 1fr, damit die
     Detailspalte beim Schrumpfen nicht ihre Mindest-Inhaltsbreite erzwingt und das
     Raster über den Rand schiebt. */
  display:grid;
  grid-template-columns:clamp(200px, 16vw, 236px) clamp(320px, 26vw, 430px) minmax(0, 1fr);
  background:var(--ink); color:var(--text);
  font-family:var(--sans); font-size:13px; line-height:1.45;
  -webkit-font-smoothing:antialiased;
}
.jb button { font:inherit; color:inherit; background:none; border:none; cursor:pointer; }
.jb :focus-visible { outline:2px solid #6EA8FF; outline-offset:1px; border-radius:3px; }

/* ---------- Sidebar ---------- */
.sb { background:var(--slate); border-right:1px solid var(--line-soft); display:flex; flex-direction:column; overflow-y:auto; }
.sb__brand { padding:16px 16px 14px; display:flex; align-items:baseline; gap:8px; }
.sb__logo { font-family:var(--mono); font-size:14px; font-weight:500; letter-spacing:-.02em; }
.sb__logo b { color:var(--text); font-weight:500; }
.sb__logo span { color:var(--dim); }
.sb__ver { font-family:var(--mono); font-size:10px; color:var(--dim); }

.sb__group { padding:0 8px; margin-bottom:4px; }
.sb__head {
  display:flex; align-items:center; gap:6px;
  padding:12px 8px 6px; font-size:10px; font-weight:600;
  letter-spacing:.09em; text-transform:uppercase; color:var(--dim);
}
.sb__head svg { width:11px; height:11px; }
.sb__rule { height:1px; background:var(--line-soft); margin:8px 16px; }

.fld {
  width:100%; display:flex; align-items:center; gap:9px;
  padding:6px 8px; border-radius:5px; color:var(--muted); text-align:left;
}
.fld:hover { background:var(--panel); color:var(--text); }
.fld--on { background:var(--raised); color:var(--text); font-weight:500; }
.fld svg { width:14px; height:14px; flex:none; opacity:.75; }
.fld__label { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fld__n { font-family:var(--mono); font-size:11px; font-variant-numeric:tabular-nums; color:var(--dim); }
.fld--on .fld__n { color:var(--muted); }
.fld--err.fld--has svg, .fld--err.fld--has .fld__n { color:var(--err); opacity:1; }
.fld__dot { width:6px; height:6px; border-radius:50%; background:var(--ok); flex:none; }

.fld__bar { height:3px; margin:0 8px 6px; background:var(--line); border-radius:99px; overflow:hidden; }
.fld__bar span {
  display:block; height:100%; border-radius:inherit; transition:width .3s ease;
  background:linear-gradient(90deg, #5B8CFF, #35D0A5, #5B8CFF);
  background-size:200% 100%;
}

.loadgrid { display:flex; flex-direction:column; gap:16px; }
.loadgrid__done-badge {
  position:absolute; right:0; bottom:-2px;
  font-size:10px; font-weight:600; letter-spacing:.02em;
  padding:2px 7px; border-radius:5px;
  background:var(--ok); color:var(--ink);
}
.loadgrid__head {
  font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:.06em;
  color:var(--muted); margin-bottom:7px;
}
.loadgrid__row { display:flex; flex-wrap:wrap; gap:3px; margin-bottom:3px; }
/* Zwei getrennte Animationen: "pop" (Erscheinen, pro Quadrat gestaffelt via --pop-delay)
   endet grau und BLEIBT grau — erst wenn die ganze Zeile fertig erschienen ist, färbt
   "color" (auf --reveal-delay verzögert, für jedes Quadrat der Zeile gleich) sie um. */
.loadgrid__sq {
  position:relative; /* Anker für Tschobbos geklebte Klumpen, siehe ui/tschobbo.js */
  width:11px; height:11px; border-radius:3px; flex:none;
  opacity:0; transform:scale(.4); background:var(--dim);
  animation-name: loadgrid-pop, loadgrid-color;
  animation-duration: .35s, .3s;
  animation-timing-function: ease-out, ease-out;
  animation-delay: var(--pop-delay, 0ms), var(--reveal-delay, 0ms);
  animation-fill-mode: forwards, forwards;
}
.loadgrid__sq--done { --final-color:#5B8CFF; }
.loadgrid__sq--error { --final-color:var(--err); }
.loadgrid__sq--excluded { --final-color:var(--dim); }
/* Filter-Ergebnis nutzt exakt die Fit-Urteilsfarben (siehe FIT oben) statt eigener
   Töne — ein Quadrat und ein Job-Zeilen-Punkt für dasselbe Urteil sehen identisch aus. */
.loadgrid__sq--matched { --final-color:var(--fit-matched); }
.loadgrid__sq--offstack { --final-color:var(--fit-offstack); }
.loadgrid__sq--brutal { --final-color:var(--fit-brutal); }
.loadgrid__sq--clickable { cursor:pointer; }
.loadgrid__sq--clickable:hover { filter:brightness(1.4); }
@keyframes loadgrid-pop { to { opacity:1; transform:scale(1); } }
@keyframes loadgrid-color { to { background:var(--final-color); } }

/* .chip/.chip--on ist für die Fit-Filter gebaut, wo ein Farbpunkt die Auswahl
   trägt — ohne Punkt (Regex/LLM) ist der Kontrast dort zu schwach, um überhaupt
   wie ein Button auszusehen. Eigener, kontrastreicherer Toggle statt .chip.
   ".jb " vorangestellt (statt nur .modebtn): ".jb button" resettet border/
   background mit höherer Spezifität (Klasse+Element) als ein einzelner
   Klassen-Selektor — ohne den Präfix gewinnt der Reset und der Toggle sieht
   aus wie reiner Text (derselbe Effekt trifft übrigens auch .chip/.btn/.fitbtn
   im Bestandscode, hier aber bewusst nur lokal für den neuen Toggle behoben). */
.modetoggle { display:flex; gap:6px; padding:10px 0; }
.jb .modebtn { padding:5px 14px; border-radius:6px; border:1px solid var(--line); color:var(--muted); font-size:12.5px; }
.jb .modebtn:hover { border-color:var(--dim); color:var(--text); }
.jb .modebtn--on { background:var(--text); color:var(--ink); border-color:var(--text); font-weight:600; }

.sb__keys { margin-top:auto; padding:14px 16px; border-top:1px solid var(--line-soft); display:flex; flex-direction:column; gap:5px; }
.key { display:flex; justify-content:space-between; font-size:11px; color:var(--dim); }
.key kbd {
  font-family:var(--mono); font-size:10px; background:var(--panel);
  border:1px solid var(--line); border-bottom-width:2px; border-radius:3px;
  padding:0 4px; color:var(--muted);
}

/* ---------- Liste ---------- */
.ls { background:var(--panel); border-right:1px solid var(--line-soft); display:flex; flex-direction:column; min-width:0; min-height:0; }
.ls__top { padding:12px 12px 0; border-bottom:1px solid var(--line-soft); }
.srch { display:flex; align-items:center; gap:8px; background:var(--ink); border:1px solid var(--line); border-radius:6px; padding:6px 9px; }
.srch svg { width:13px; height:13px; color:var(--dim); flex:none; }
.srch input { flex:1; background:none; border:none; outline:none; color:var(--text); font:inherit; min-width:0; }
.srch input::placeholder { color:var(--dim); }

/* Die Reihe war bei JEDER Fensterbreite breiter als ihre Spalte — bei 1024 um 168px, ab
   1280 um 116px, selbst auf 2560 noch, weil die Listenspalte nie mitwächst. Sie lag in
   einem overflow-x:auto mit scrollbar-width:none, sah also abgeschnitten aus statt
   scrollbar. Umbruch statt Scrollen: eine Filterreihe, die man nicht ganz sieht, ist als
   Filter wertlos, und zwei Zeilen kosten hier 28px. Erst mit einer Listenspalte jenseits
   von 600px passte sie in eine Zeile — so breit soll die Liste aber gar nicht werden. */
.chips { display:flex; flex-wrap:wrap; gap:5px; padding:10px 0; }
.chip {
  display:flex; align-items:center; gap:6px; flex:none;
  padding:3px 9px; border-radius:99px; border:1px solid var(--line);
  color:var(--muted); font-size:11.5px; white-space:nowrap;
}
.chip:hover { border-color:var(--dim); color:var(--text); }
.chip--on { background:var(--raised); border-color:transparent; color:var(--text); font-weight:500; }
.chip__dot { width:6px; height:6px; border-radius:99px; flex:none; }
.chip__n { font-family:var(--mono); font-size:10px; color:var(--dim); font-variant-numeric:tabular-nums; }

.ls__scroll { flex:1; min-height:0; overflow-y:auto; }

.row-wrap { display:flex; align-items:stretch; border-bottom:1px solid var(--line-soft); }
.row__check { flex:none; align-self:center; margin-left:14px; accent-color:var(--text); cursor:pointer; }
/* Ungefilterte Jobs (status "new") sitzen mit im "jobs"-Ordner, taugen aber nicht
   fürs Anschreiben — Checkbox bleibt sichtbar (die Spalte soll nicht springen),
   nur eben erkennbar tot. */
.row__check:disabled { cursor:not-allowed; opacity:.3; }

.row {
  position:relative; width:100%; display:block; text-align:left;
  padding:11px 12px 11px 18px;
}
.row:hover { background:var(--raised); }
.row--on { background:var(--raised); }
.row--on::after { content:''; position:absolute; right:0; top:0; bottom:0; width:2px; background:var(--text); }
.row--dim { opacity:.58; }
.row--dim:hover, .row--dim.row--on { opacity:1; }
.rail { position:absolute; left:0; top:0; bottom:0; width:3px; }

/* wrap, weil die Listenspalte schmal ist: mit fünf Aktionen passt die Leiste dort
   nicht mehr in eine Zeile und die letzten Knöpfe verschwänden unter der Detailspalte.
   Kein flex:1-Spacer mehr — der würde beim Umbruch eine ganze Zeile fressen. */
.selbar {
  display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; padding:8px 12px;
  border-bottom:1px solid var(--line-soft); background:var(--raised);
  font-size:12px; color:var(--muted);
}
.selbar__n { flex:none; font-weight:500; color:var(--text); margin-right:2px; }

/* Nachfass-Zeile: flacher als .row (kein Snippet, kein Fit-Rail) — die Liste ist eine
   Auswahlliste, kein Job-Browser. */
.nf__row {
  display:grid; grid-template-columns:auto 1fr 2fr auto; align-items:center; gap:10px;
  padding:7px 4px; border-bottom:1px solid var(--line-soft); cursor:pointer; font-size:12.5px;
}
.nf__row:hover { background:var(--raised); }
.nf__firma { color:var(--text); font-weight:500; }
.nf__titel { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nf__meta { display:flex; align-items:center; gap:6px; justify-self:end; }
.selbar .btn { padding:5px 10px; white-space:nowrap; }
.sel__hint { color:var(--dim); }
/* Natives <select> auf .btn getrimmt: eigene Optik, aber das Menü bleibt das des
   Betriebssystems (Tastatur, Touch, kein offener Zustand im React-State). */
.selbar__menu { appearance:none; background:transparent; cursor:pointer; padding-right:11px; }
.selbar__menu option { background:var(--panel); color:var(--text); }

.row__l1 { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }
.row__firma { font-weight:600; font-size:13px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row__age { font-family:var(--mono); font-size:10.5px; color:var(--dim); flex:none; font-variant-numeric:tabular-nums; }
/* display:block ist hier Pflicht, nicht Kosmetik: als <span> sind beide inline, und an
   inline-Elementen sind overflow/text-overflow/margin-bottom wirkungslos. Deshalb liefen
   Titel und Ausschnitt bisher in einer Zeile ineinander ("…ADMINISTRATOR:INAls Quereinsteiger")
   statt untereinander mit Auslassungspunkten. */
.row__titel { display:block; font-size:12.5px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-bottom:4px; }
.row__snip { display:block; font-size:11.5px; color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row__meta { display:flex; align-items:center; gap:7px; margin-top:6px; }
.tag {
  font-family:var(--mono); font-size:9.5px; letter-spacing:.04em;
  padding:1px 5px; border-radius:3px; border:1px solid var(--line); color:var(--dim);
}
.tag--nomail { border-style:dashed; }
.tag--err { border-color:rgba(229,72,77,.4); color:var(--err); }
.tag--roh { border-style:dotted; border-color:rgba(232,176,75,.45); color:var(--fit-offstack); }
.tag--reply { border-color:rgba(53,208,165,.4); color:var(--ok); }

.empty { padding:56px 24px; text-align:center; color:var(--dim); }
.empty__h { color:var(--muted); font-weight:500; margin-bottom:5px; font-size:13px; }

/* ---------- Detail ---------- */
.dt { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--ink); }
.dt__back { display:none; }
.dt__head { padding:18px 24px 14px; border-bottom:1px solid var(--line-soft); }
.dt__firma { font-size:18px; font-weight:600; letter-spacing:-.01em; margin-bottom:3px; }
.dt__titel { color:var(--muted); font-size:13.5px; margin-bottom:11px; }
.dt__meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-family:var(--mono); font-size:11px; color:var(--dim); }
.dt__sep { color:var(--line); }
.dt__mail { color:var(--muted); }
.dt__nomail { color:var(--dim); font-style:italic; font-family:var(--sans); }
.lnk { display:inline-flex; align-items:center; gap:3px; color:var(--dim); }
.lnk:hover { color:var(--text); }
.lnk svg { width:10px; height:10px; }

/* Babyblau statt Standard-Browserblau, Rosa statt Lila für besuchte Links — weniger
   aggressiv auf dem dunklen Hintergrund. */
.dup-lnk:link { color:#8ecae6; }
.dup-lnk:visited { color:#e8a0c4; }
.dup-lnk:hover { color:var(--text); }

.fitpick { display:flex; align-items:center; gap:7px; margin-top:12px; }
.fitpick__lbl { font-size:11px; color:var(--dim); }
.fitbtn {
  display:flex; align-items:center; gap:5px; padding:2px 8px;
  border:1px solid var(--line); border-radius:99px; font-size:11px; color:var(--dim);
}
.fitbtn:hover { border-color:var(--dim); }
.fitbtn--on { border-color:transparent; font-weight:500; }

.tabs { display:flex; gap:2px; padding:10px 24px 0; border-bottom:1px solid var(--line-soft); }
.tab { padding:6px 11px; border-radius:5px 5px 0 0; color:var(--dim); font-size:12.5px; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tab:hover { color:var(--text); }
.tab--on { color:var(--text); border-bottom-color:var(--text); font-weight:500; }

.dt__body { flex:1; min-height:0; overflow-y:auto; padding:22px 24px; }

/* ---------- Anhang ---------- */
.att { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--ink); grid-column:span 2; }
.dropzone {
  display:flex; align-items:center; justify-content:center; text-align:center;
  margin-top:16px; padding:28px; border:1px dashed var(--line); border-radius:8px;
  color:var(--dim); font-size:12.5px; cursor:pointer; max-width:420px;
}
.dropzone:hover { border-color:var(--dim); color:var(--muted); }
.dropzone input { display:none; }

/* Das Anschreiben: einzige helle Fläche der App. Es ist ein Brief, kein UI. */
.paper {
  background:var(--paper); color:var(--paper-ink);
  border-radius:3px; padding:34px 38px;
  box-shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px -8px rgba(0,0,0,.6);
  max-width:660px;
}
.paper__to {
  font-family:var(--mono); font-size:10.5px; color:#8C8A83;
  padding-bottom:14px; margin-bottom:20px; border-bottom:1px solid var(--paper-line);
  display:flex; justify-content:space-between; gap:12px;
}
.paper__ta {
  width:100%; background:none; border:none; outline:none; resize:none;
  font-family:var(--serif); font-size:14.5px; line-height:1.72; color:var(--paper-ink);
  display:block; overflow:hidden;
}
.paper__ta::selection { background:#C9DCF5; }
.paper__foot {
  margin-top:22px; padding-top:12px; border-top:1px solid var(--paper-line);
  font-family:var(--mono); font-size:10px; color:#9B9891; display:flex; justify-content:space-between;
}

.inserat { max-width:660px; font-size:13px; line-height:1.7; color:var(--muted); white-space:pre-wrap; }
.inserat h4 { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--dim); margin:0 0 10px; font-weight:600; }

.errbox { max-width:660px; border:1px solid rgba(229,72,77,.3); background:rgba(229,72,77,.06); border-radius:6px; padding:16px 18px; margin-bottom:20px; }
.errbox__h { display:flex; align-items:center; gap:7px; color:var(--err); font-weight:600; font-size:12.5px; margin-bottom:7px; }
.errbox__h svg { width:14px; height:14px; }
.errbox__msg { font-family:var(--mono); font-size:11.5px; line-height:1.6; color:var(--muted); }

.bar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:12px 24px; border-top:1px solid var(--line-soft); background:var(--slate); }
.btn { display:flex; align-items:center; gap:6px; padding:6px 13px; border-radius:5px; border:1px solid var(--line); color:var(--muted); font-size:12.5px; }
.btn:hover { border-color:var(--dim); color:var(--text); }
.btn svg { width:13px; height:13px; }
.btn--primary { background:var(--text); color:var(--ink); border-color:var(--text); font-weight:600; }
.btn--primary:hover { background:#fff; border-color:#fff; color:var(--ink); }
.btn--ghost { border-color:transparent; }
.btn--danger:hover { border-color:rgba(229,72,77,.5); color:var(--err); }
.bar__spacer { flex:1; }
.bar__hint { font-family:var(--mono); font-size:10.5px; color:var(--dim); }

/* Rechts oben statt mittig unten — verdeckt so nicht den Content-Fokus in der Mitte.
   Alternative (mittig auf Augenhöhe), falls gewünscht, wäre hier eine Ein-Zeilen-Änderung:
   top:50%; left:50%; transform:translate(-50%,-50%); (position bleibt sonst gleich). */
.toaststack {
  position:fixed; top:20px; right:20px; z-index:50;
  display:flex; flex-direction:column; gap:8px;
}
.toast {
  background:var(--raised); border:1px solid var(--line); border-radius:6px;
  padding:8px 15px; font-size:12.5px; box-shadow:0 8px 24px rgba(0,0,0,.5);
  display:flex; align-items:center; gap:7px;
}
.toast svg { width:14px; height:14px; flex:none; }
.toast--ok { border-color:rgba(53,208,165,.4); }
.toast--ok svg { color:var(--ok); }
.toast--err { border-color:rgba(229,72,77,.4); }
.toast--err svg { color:var(--err); }

@media (prefers-reduced-motion:no-preference) {
  .toast { animation:rise .16s ease-out; }
  @keyframes rise { from { opacity:0; transform:translateY(-6px); } }
}

/* ---------- Kalender ---------- */
/* Eigene Ansicht (7-Spalten-Wochenraster), aber dieselben Farbtokens wie das Lade-Grid:
   --fit-matched für "gesendet", --ok für "Antwort" (deckt sich mit .tag--reply, das
   dieselbe Farbe für "hat geantwortet" in der Job-Liste nutzt). */
.cal { display:flex; flex-direction:column; min-width:0; min-height:0; background:var(--ink); grid-column:span 2; }
.cal__head-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.cal__legende { display:flex; gap:14px; margin-top:8px; font-size:11px; color:var(--dim); }
.cal__legende > span { display:flex; align-items:center; gap:5px; }
.cal__body { flex:1; min-height:0; overflow-y:auto; padding:22px 24px; display:flex; flex-direction:column; gap:28px; }
.cal__month-h {
  display:flex; align-items:center; gap:8px; width:100%; padding:4px 0;
  font-size:13px; font-weight:600; color:var(--text); margin-bottom:8px;
  text-transform:capitalize; text-align:left; cursor:pointer;
}
.cal__month-h:hover { color:var(--text); }
.cal__month-h:hover .cal__month-sum { color:var(--muted); }
.cal__caret { display:inline-block; color:var(--dim); font-size:10px; transition:transform .12s ease; }
.cal__caret--offen { transform:rotate(90deg); }
.cal__month-sum { font-family:var(--mono); font-size:10px; font-weight:400; color:var(--dim); text-transform:none; }
.cal__weekday-row, .cal__grid { display:grid; grid-template-columns:repeat(7, 34px); gap:4px; }
.cal__weekday-row { font-family:var(--mono); font-size:9.5px; color:var(--dim); text-align:center; margin-bottom:4px; }
.cal__sq {
  width:34px; height:34px; border-radius:5px; border:1px solid var(--line);
  display:flex; align-items:flex-end; justify-content:flex-end; padding:3px 4px;
  font-family:var(--mono); font-size:10px; color:var(--dim);
}
.cal__sq--pad { visibility:hidden; }
/* Farbe kommt inline aus CAL_COLOR (ein Tag kann gesendet + nachgefasst + Antwort
   tragen, das wären sonst sieben Kombinationsklassen) — hier bleibt nur, was für
   jeden gefüllten Tag gleich ist. */
.cal__sq--filled { border-color:transparent; color:var(--ink); }
.cal__sq--active { cursor:pointer; }
.cal__sq--active:hover { filter:brightness(1.15); }

.cal__hover {
  position:fixed; z-index:60; pointer-events:none;
  background:var(--raised); border:1px solid var(--line); border-radius:6px;
  padding:6px 10px; font-size:11.5px; color:var(--text); box-shadow:0 8px 24px rgba(0,0,0,.5);
  white-space:nowrap;
}

.cal__overlay { position:fixed; inset:0; background:rgba(0,0,0,.55); z-index:70; display:flex; align-items:center; justify-content:center; }
.cal__popup { width:380px; max-height:70vh; display:flex; flex-direction:column; background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,.6); }
.cal__popup-head { padding:14px 18px; border-bottom:1px solid var(--line-soft); font-weight:600; font-size:13.5px; text-transform:capitalize; }
.cal__popup-list { flex:1; min-height:0; overflow-y:auto; padding:6px 8px; }
.cal__entry { display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border-radius:5px; text-align:left; }
.cal__entry:hover { background:var(--raised); }
/* Aus Gmail, kein Job dazu — nicht anklickbar, aber vollwertig sichtbar: der Eintrag
   ist der einzige Beleg für diese Bewerbung. */
.cal__entry--nurmail { cursor:default; }
.cal__entry--nurmail:hover { background:transparent; }
.cal__entry__quelle {
  font-family:var(--mono); font-size:9px; letter-spacing:.04em; flex:none;
  padding:1px 5px; border-radius:3px; border:1px dotted var(--line); color:var(--dim);
}
.cal__entry__dot { width:7px; height:7px; border-radius:99px; flex:none; }
.cal__entry__firma { font-weight:500; font-size:12.5px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cal__entry__titel { font-size:11px; color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:130px; }
.cal__popup-foot { padding:8px 18px; border-top:1px solid var(--line-soft); font-family:var(--mono); font-size:10px; color:var(--dim); }

/* ---------- Responsive ---------- */
/* ---------- Einstellungsseite "Suche" ---------- */
.cfg { display:flex; flex-direction:column; gap:34px; max-width:820px; }
.cfg__block { display:flex; flex-direction:column; gap:12px; }
.cfg__h {
  display:flex; align-items:baseline; gap:10px; margin:0;
  font-family:var(--mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted);
}
.cfg__h span { font-size:10.5px; letter-spacing:0; text-transform:none; color:var(--dim); }
.cfg__erklaerung { margin:0; font-size:12px; color:var(--dim); max-width:60ch; }

.cfg__portal { border:1px solid var(--line-soft); border-radius:6px; padding:11px 13px; display:flex; flex-direction:column; gap:9px; }
.cfg__portal--aus { opacity:.55; }
.cfg__portal--aus:focus-within, .cfg__portal--aus:hover { opacity:1; }
.cfg__portal-kopf { display:flex; align-items:center; gap:10px; }
.cfg__portal-name { font-weight:600; font-size:13px; flex:1; }
.cfg__schalter { display:flex; align-items:center; gap:6px; font-family:var(--mono); font-size:10.5px; color:var(--dim); cursor:pointer; }

.cfg__chips { display:flex; flex-wrap:wrap; align-items:center; gap:5px; }
.cfg__chip {
  display:inline-flex; align-items:center; gap:5px; padding:3px 4px 3px 9px; border-radius:99px;
  border:1px solid var(--line); color:var(--muted); font-size:11.5px; white-space:nowrap;
}
.cfg__chip-x { color:var(--dim); font-size:13px; line-height:1; padding:2px 5px; border-radius:99px; }
.cfg__chip-x:hover { color:var(--err); background:var(--raised); }
.cfg__add {
  flex:1; min-width:150px; background:var(--ink); border:1px dashed var(--line); border-radius:99px;
  color:var(--text); font:inherit; font-size:11.5px; padding:3px 10px; outline:none;
}
.cfg__add:focus { border-style:solid; border-color:var(--dim); }
.cfg__add::placeholder { color:var(--dim); }

/* Zeilenform für Anfragen mit mehreren Feldern (linkedin, ams) — ein Chip müsste zum
   Ändern ohnehin aufklappen, dann kann es gleich eine Zeile sein. */
.cfg__zeilen { display:flex; flex-direction:column; gap:4px; }
.cfg__zeile { display:grid; gap:6px; align-items:center; }
.cfg__zeile--kopf { font-family:var(--mono); font-size:10px; letter-spacing:.05em; text-transform:uppercase; color:var(--dim); }
.cfg__feld {
  background:var(--ink); border:1px solid var(--line); border-radius:5px;
  color:var(--text); font:inherit; font-size:12px; padding:4px 8px; outline:none; min-width:0;
}
.cfg__feld:focus { border-color:var(--dim); }
.cfg__plus { align-self:flex-start; margin-top:2px; }

.cfg__warn {
  flex:1 0 100%; display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:4px;
  border:1px solid rgba(232,176,75,.4); background:rgba(232,176,75,.07); border-radius:6px;
  padding:9px 11px; font-size:12px; color:var(--fit-offstack);
}
.cfg__warn > span { flex:1 1 240px; }

.cfg__kaputt, .cfg__verwaist {
  border:1px solid rgba(232,98,42,.35); background:rgba(232,98,42,.06); border-radius:6px;
  padding:11px 13px; font-size:12px; color:var(--muted);
  display:flex; flex-direction:column; gap:7px;
}
.cfg__verwaist { flex-direction:row; align-items:center; gap:10px; }
.cfg__kaputt b { color:var(--fit-brutal); font-size:12.5px; }
.cfg__kaputt-zeile { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.cfg__kaputt-zeile > span { flex:1 1 260px; }

.cfg__gruppe { display:flex; flex-direction:column; gap:6px; }
.cfg__gruppe-name { font-size:12px; color:var(--dim); }

.cfg__roh { display:flex; flex-direction:column; gap:8px; align-items:flex-start; margin-top:4px; }
.cfg__roh-kopf { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--muted); }
.cfg__roh-kopf:hover { color:var(--text); }
.cfg__roh-hint { font-family:var(--mono); font-size:10px; color:var(--dim); }
.cfg__roh-text {
  width:100%; max-height:340px; overflow:auto; margin:0;
  background:var(--ink); border:1px solid var(--line-soft); border-radius:6px; padding:11px 13px;
  font-family:var(--mono); font-size:11px; line-height:1.6; color:var(--muted);
}
.cfg__leiste { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; }

/* ---------- Mobile Kopfzeile + Schublade ---------- */
/* Beide existieren nur unterhalb von 1024. Darüber ist .sb eine normale Rasterspalte,
   und diese Regeln fassen sie nicht an. */
.topbar { display:none; }
.sb__overlay { display:none; }

/* Umschaltpunkt von 960 auf 1024 gehoben: dazwischen standen drei Spalten auf zu wenig
   Platz (bei 1024 waren es 208+320+496). Ab hier ist die Seitenleiste eine Schublade. */
@media (max-width:1023px) {
  .jb { grid-template-columns:minmax(0, 1fr); }
  .ls { border-right:none; }
  .dt { display:none; }
  .jb--detail .ls { display:none; }
  .jb--detail .dt { display:flex; }
  .dt__back { display:flex; align-items:center; gap:5px; padding:11px 16px 0; color:var(--muted); font-size:12.5px; }
  .dt__back svg { width:14px; height:14px; }
  .dt__head, .dt__body, .tabs, .bar { padding-left:16px; padding-right:16px; }
  .paper { padding:24px 22px; }

  /* Die Pipeline-Ansichten sind für zwei Spalten gebaut. Im Ein-Spalten-Raster erzeugt
     span 2 eine implizite zweite Spalte — heute 0px breit und damit harmlos, aber sie
     sitzen dort aus Versehen richtig statt aus Absicht. */
  .att, .cal { grid-column:1 / -1; }

  /* Trefferflächen: 13px-Zeilen und ein 13px-Kästchen sind für den Daumen zu klein. */
  .fld { min-height:44px; }
  .chip { padding:8px 12px; }
  .row__check { width:20px; height:20px; margin-left:12px; }
  .row { padding-top:14px; padding-bottom:14px; }

  /* Kalender wächst mit, statt bei 7×34px stehenzubleiben. */
  .cal__weekday-row, .cal__grid { grid-template-columns:repeat(7, minmax(0, 1fr)); }
  .cal__sq { width:auto; }

  /* Mehrfeldrige Anfragen stapeln statt nebeneinander — drei Felder auf 390px sind
     drei unlesbare Spalten. Die Kopfzeile entfällt dabei, die Platzhalter tragen. */
  .cfg__zeile { grid-template-columns:1fr auto !important; }
  .cfg__zeile--kopf { display:none; }
  .cfg__zeile .cfg__feld { grid-column:1; }
  .cfg__zeile .cfg__chip-x { grid-row:1; grid-column:2; }
  /* Gestapelt sind drei Anfragen zu je zwei Feldern sechs Kästen untereinander — ohne
     Klammer sieht man nicht, welche zusammengehören. */
  .cfg__zeilen .cfg__zeile:not(.cfg__zeile--kopf) {
    border:1px solid var(--line-soft); border-radius:6px; padding:7px; background:var(--slate);
  }

  /* Nachfass-Zeile zweizeilig: Firma+Titel oben, Adresse+Alter darunter. */
  .nf__row { grid-template-columns:auto 1fr; row-gap:4px; }
  .nf__titel { grid-column:2; }
  .nf__meta { grid-column:2; justify-self:start; }

  /* top statt padding-top: .jb ist position:fixed;inset:0 und selbst NICHT von der
     border-box-Regel erfasst (die gilt für .jb *), ein padding würde es zu hoch machen. */
  .jb { top:48px; }
  .topbar {
    position:fixed; top:0; left:0; right:0; height:48px; z-index:58;
    display:flex; align-items:center; gap:10px; padding:0 8px;
    background:var(--slate); border-bottom:1px solid var(--line-soft);
  }
  .topbar__burger {
    display:flex; align-items:center; justify-content:center;
    width:40px; height:40px; border-radius:6px; color:var(--muted); flex:none;
  }
  .topbar__burger:hover { color:var(--text); background:var(--raised); }
  .topbar__burger svg { width:18px; height:18px; }
  .topbar__wo { font-weight:600; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .topbar__n { font-family:var(--mono); font-size:11px; color:var(--dim); flex:none; margin-left:auto; }

  /* Schublade: fährt über den Inhalt statt ihn zu verschieben — der Inhalt ist hier
     ohnehin nur eine Spalte breit, ein Wegschieben würde ihn unlesbar quetschen. */
  .sb {
    position:fixed; top:0; bottom:0; left:0; z-index:60;
    width:min(300px, 84vw); transform:translateX(-100%);
  }
  .sb--offen { transform:none; box-shadow:0 0 40px rgba(0,0,0,.5); }
  .sb__overlay { display:block; position:fixed; inset:0; z-index:59; background:rgba(0,0,0,.5); }
}
@media (max-width:1023px) and (prefers-reduced-motion:no-preference) {
  .sb { transition:transform .18s ease-out; }
}

/* Band C: ab 2000px hat die Detailspalte Platz für zwei Bahnen (bei 2560 sind es 1894px).
   Statt Anschreiben UND Inserat übereinander umzuschalten, stehen sie nebeneinander — beim
   Prüfen liest man den Brief gegen das Inserat, und genau dafür war der Platz bisher leer.
   Die Tabs verschwinden, weil es nichts mehr umzuschalten gibt. */
.dt__panels--brief .dt__panel--inserat,
.dt__panels--inserat .dt__panel--brief { display:none; }

@media (min-width:2000px) {
  .tabs { display:none; }
  .dt__panels {
    display:grid; grid-template-columns:minmax(0, 660px) minmax(0, 720px);
    gap:36px; align-items:start; justify-content:start;
  }
  /* schlägt die Tab-Regel oben, weil gleich spezifisch und später im Stylesheet */
  .dt__panels--brief .dt__panel--inserat,
  .dt__panels--inserat .dt__panel--brief { display:block; }
  /* Eine Zeile "Ort · Quelle · Alter · Hinweis" über 1500px ist keine Zeile mehr,
     sondern eine Fährte. */
  .dt__head > * { max-width:1100px; }
}

`;

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
  'log/geloescht': 'Nichts gelöscht.',
  'log/fehler': 'Keine Fehler.',
};

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

// Ein Grid-Muster für alle drei Lade-Anzeigen (Scrape/Filter/Anschreiben) statt drei
// eigener Implementierungen — Abschnitt (z.B. Quelle) -> Zeile (z.B. Batch) -> Quadrate
// (ein Item, fertig oder Fehler). Hover-Tooltip ist der native `title`-Attribut-Tooltip
// des Browsers statt eines eigenen Tooltip-Bauteils — reicht für "Kurzinfo beim Hover".
type LoadGridSquare = {
  id: string;
  tooltip: string;
  state: 'done' | 'error' | 'excluded' | 'matched' | 'offstack' | 'brutal';
  url?: string;
};
type LoadGridRow = { key: string; squares: LoadGridSquare[] };
type LoadGridSection = { key: string; label: string; rows: LoadGridRow[] };

const ROW_DURATION_MS = 4000;
// Muss zur .35s-Pop-Dauer in der CSS oben passen — der Moment, an dem das LETZTE
// Quadrat einer Zeile fertig erschienen ist (danach färbt sich die ganze Zeile ein).
const POP_DURATION_MS = 350;

// ghost: Quadrate bleiben im Layout (Tschobbo braucht ihre Positionen als
// Wurfziele), werden aber unsichtbar + nicht klickbar — nur die Scrape-Section
// nutzt das, seit Tschobbo dort Klumpen statt Quadraten zeigt (siehe ui/tschobbo.js).
function LoadGrid({ sections, ghost }: { sections: LoadGridSection[]; ghost?: boolean }) {
  return (
    <div className="loadgrid">
      {sections.map(s => (
        <div className="loadgrid__section" key={s.key}>
          <div className="loadgrid__head">{s.label}</div>
          {s.rows.map(r => {
            // Feste Gesamtdauer pro Zeile (Kevin: "eine Zeile auf 4 Sek") statt fixem
            // Versatz pro Quadrat — sonst bräuchte eine 10er-Zeile 10x so lang wie eine
            // 1er-Zeile (Anschreiben). Bei 1 Quadrat entfällt der Versatz automatisch.
            const step = ROW_DURATION_MS / r.squares.length;
            // Gleich für jedes Quadrat der Zeile — erst wenn ALLE erschienen sind
            // (letztes Quadrat bei (n-1)*step + Pop-Dauer), färbt sich die Zeile ein.
            const revealDelay = (r.squares.length - 1) * step + POP_DURATION_MS;
            return (
              // data-row: Tschobbo (ui/tschobbo.js) muss bei parallelen Quellen die
              // Zeile aus dem Event finden können, nicht raten — DOM-Reihenfolge ist
              // nach Section gruppiert, nicht nach Event-Chronologie.
              <div className="loadgrid__row" key={r.key} data-row={r.key}>
                {r.squares.map((sq, i) => (
                  <span
                    key={sq.id}
                    className={'loadgrid__sq loadgrid__sq--' + sq.state + (sq.url ? ' loadgrid__sq--clickable' : '') + (ghost ? ' loadgrid__sq--ghost' : '')}
                    title={sq.tooltip}
                    onClick={sq.url ? () => window.open(sq.url, '_blank', 'noopener,noreferrer') : undefined}
                    style={{ '--pop-delay': `${i * step}ms`, '--reveal-delay': `${revealDelay}ms` } as React.CSSProperties}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Hülle ums Grid, geteilt von Scrape/Filter/Anschreiben: bleibt nach Laufende stehen
// (Kevin: "verschwindet zu schnell"), bis der Schließen-Button sie wegräumt oder ein
// neuer Lauf sections auf [] zurücksetzt (siehe runScrapeNow/runFilterNow/runAnschreibenNow).
function LoadGridPanel({ running, sections, onClose, ghost }: { running: boolean; sections: LoadGridSection[]; onClose: () => void; ghost?: boolean }) {
  return (
    <div className="empty" style={{ textAlign: 'left', padding: '8px 0', position: 'relative' }}>
      <div className="empty__h" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>{running ? 'Läuft…' : ''}</span>
        {!running && (
          <button className="btn" style={{ padding: '2px 10px', fontSize: 11.5 }} onClick={onClose}>
            Schließen
          </button>
        )}
      </div>
      {sections.length === 0 ? 'Startet…' : <LoadGrid sections={sections} ghost={ghost} />}
      {!running && <span className="loadgrid__done-badge">Fertig</span>}
    </div>
  );
}

function formatDayLong(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}
function formatDayShort(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}
function summarizeDay(date: string, bucket: DayBucket | undefined): string {
  const parts = CAL_TYPES.filter(t => bucket?.[t].length).map(t => CAL_LABEL[t](bucket![t].length));
  return `${formatDayShort(date)} · ${parts.join(' · ')}`;
}

type DayBucket = { sent: CalendarEvent[]; followup: CalendarEvent[]; reply: CalendarEvent[] };

// Reihenfolge = Chronologie einer Bewerbung: raus, nachgehakt, Antwort. Sie bestimmt
// auch, wie die Streifen im Tagesquadrat liegen und wie das Popup sortiert.
const CAL_TYPES = ['sent', 'followup', 'reply'] as const;
const CAL_COLOR: Record<CalendarEvent['type'], string> = {
  sent: 'var(--fit-matched)',
  followup: 'var(--fit-offstack)',
  reply: 'var(--ok)',
};
const CAL_LABEL: Record<CalendarEvent['type'], (n: number) => string> = {
  sent: n => `${n} gesendet`,
  followup: n => `${n}× nachgefasst`,
  reply: n => `${n} Antwort${n > 1 ? 'en' : ''}`,
};

// Ein Tag kann jetzt drei Sorten tragen — statt für jede Kombination eine eigene
// CSS-Klasse (--sent/--reply/--both/…) wächst der Verlauf aus den tatsächlich
// vorhandenen Farben. Eine Farbe bleibt einfarbig.
function calBackground(farben: string[]): string {
  if (farben.length === 1) return farben[0];
  const stufe = 100 / farben.length;
  const stops = farben.map((f, i) => `${f} ${i * stufe}% ${(i + 1) * stufe}%`);
  return `linear-gradient(135deg, ${stops.join(', ')})`;
}

function calTypesOf(bucket: DayBucket | undefined): CalendarEvent['type'][] {
  return CAL_TYPES.filter(t => (bucket?.[t].length ?? 0) > 0);
}

// Ein Monatsblock: Monatsüberschrift + 7-Spalten-Wochenraster (Mo–So), führende
// Leerzellen für den Wochentags-Versatz des Monatsersten. Kein Auffüllen am Ende
// der letzten Woche — optisch unauffällig, spart eine zweite Padding-Rechnung.
function CalendarMonth({ month, byDate, offen, onToggle, onHover, onOpenDay }: {
  month: string;
  byDate: Map<string, DayBucket>;
  offen: boolean;
  onToggle: () => void;
  onHover: (h: { x: number; y: number; text: string } | null) => void;
  onOpenDay: (date: string) => void;
}) {
  const [year, mo] = month.split('-').map(Number);
  const firstWeekday = (new Date(year, mo - 1, 1).getDay() + 6) % 7; // Mo=0..So=6
  const daysInMonth = new Date(year, mo, 0).getDate();
  const label = new Date(year, mo - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Monatssumme in der Überschrift: ein eingeklappter Monat soll trotzdem sagen, ob
  // sich das Aufklappen lohnt.
  const summen: Record<CalendarEvent['type'], number> = { sent: 0, followup: 0, reply: 0 };
  for (let d = 1; d <= daysInMonth; d++) {
    const bucket = byDate.get(`${month}-${String(d).padStart(2, '0')}`);
    for (const t of CAL_TYPES) summen[t] += bucket?.[t].length ?? 0;
  }
  const summe = CAL_TYPES.filter(t => summen[t]).map(t => CAL_LABEL[t](summen[t])).join(' · ');

  return (
    <div>
      <button className="cal__month-h" onClick={onToggle} aria-expanded={offen}>
        <span className={'cal__caret' + (offen ? ' cal__caret--offen' : '')}>▸</span>
        {label}
        <span className="cal__month-sum">{summe || 'keine Aktivität'}</span>
      </button>
      {!offen ? null : <>
      <div className="cal__weekday-row">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="cal__grid">
        {cells.map((day, i) => {
          if (day == null) return <span key={'pad' + i} className="cal__sq cal__sq--pad" />;
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const bucket = byDate.get(date);
          const typen = calTypesOf(bucket);
          const active = typen.length > 0;
          const cls = 'cal__sq' + (active ? ' cal__sq--filled cal__sq--active' : '');
          return (
            <span
              key={date}
              className={cls}
              style={active ? { background: calBackground(typen.map(t => CAL_COLOR[t])) } : undefined}
              onClick={active ? () => onOpenDay(date) : undefined}
              onMouseMove={active ? (e) => onHover({ x: e.clientX, y: e.clientY, text: summarizeDay(date, bucket) }) : undefined}
              onMouseLeave={active ? () => onHover(null) : undefined}
            >
              {day}
            </span>
          );
        })}
      </div>
      </>}
    </div>
  );
}

// Eigenes Hover-Element statt native title (Verzögerung/Optik, dieselbe Entscheidung
// stand beim Lade-Grid noch offen) + Tages-Popup mit Pfeiltasten-Navigation über
// activeDates (nur Tage mit Aktivität — leere Tage werden beim Wechseln übersprungen).
function CalendarView({ events, onOpenJob }: { events: CalendarEvent[]; onOpenJob: (id: string) => void }) {
  const byDate = useMemo(() => {
    const m = new Map<string, DayBucket>();
    for (const ev of events) {
      const bucket = m.get(ev.date) ?? { sent: [], followup: [], reply: [] };
      bucket[ev.type].push(ev);
      m.set(ev.date, bucket);
    }
    return m;
  }, [events]);

  // Durchgehende Reihe ab HISTORY_START bis mindestens heute — auch Monate ohne
  // Aktivität bekommen einen Block, damit der Zeitraum, den der Gmail-Sync scannt,
  // im Kalender vollständig sichtbar ist statt auf die Treffermonate zusammenzuschrumpfen.
  const months = useMemo(() => {
    const letzter = [...byDate.keys()].sort().at(-1) ?? '';
    const heute = new Date().toISOString().slice(0, 10);
    return monthsDescending(HISTORY_START, letzter > heute ? letzter : heute);
  }, [byDate]);

  const activeDates = useMemo(() => [...byDate.keys()].sort(), [byDate]);

  // Monate ohne Aktivität starten eingeklappt: sie sind nur da, um den Zeitraum
  // lückenlos zu zeigen, und sollen die Monate mit Inhalt nicht wegdrücken. Gespeichert
  // wird nur die Abweichung vom Standard, nicht der Zustand selbst — sonst müsste die
  // Menge jedes Mal nachgezogen werden, wenn neue Ereignisse einen Monat füllen.
  const [umgeschaltet, setUmgeschaltet] = useState<Set<string>>(new Set());
  const mitAktivitaet = useMemo(
    () => new Set([...byDate.keys()].map(d => d.slice(0, 7))),
    [byDate]
  );
  const istOffen = (m: string) => (umgeschaltet.has(m) ? !mitAktivitaet.has(m) : mitAktivitaet.has(m));
  const umschalten = (m: string) => setUmgeschaltet(prev => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeDay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setActiveDay(null); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = activeDates.indexOf(activeDay);
        const next = e.key === 'ArrowLeft' ? activeDates[i - 1] : activeDates[i + 1];
        if (next) setActiveDay(next);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        listRef.current?.scrollBy({ top: e.key === 'ArrowDown' ? 40 : -40 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeDay, activeDates]);

  // Ganz ohne Ereignisse wäre der Kalender nur eine Reihe leerer Monatsköpfe — die
  // Erklärung ist dann nützlicher als das Raster.
  if (events.length === 0) {
    return (
      <div className="empty" style={{ textAlign: 'left', padding: '8px 0' }}>
        <div className="empty__h">Noch keine Aktivität</div>
        Sobald eine Bewerbung versendet wird, du nachfasst oder eine Antwort eintrifft, erscheint sie hier.
      </div>
    );
  }

  // Chronologisch nach CAL_TYPES: erst die Bewerbung, dann die Nachfassen, dann die Antwort.
  const dayEntries = activeDay ? CAL_TYPES.flatMap(t => byDate.get(activeDay)?.[t] ?? []) : [];

  return (
    <>
      {months.map(month => (
        <CalendarMonth
          key={month}
          month={month}
          byDate={byDate}
          offen={istOffen(month)}
          onToggle={() => umschalten(month)}
          onHover={setHover}
          onOpenDay={setActiveDay}
        />
      ))}
      {hover && <div className="cal__hover" style={{ left: hover.x + 14, top: hover.y + 14 }}>{hover.text}</div>}
      {activeDay && (
        <div className="cal__overlay" onClick={() => setActiveDay(null)}>
          <div className="cal__popup" onClick={e => e.stopPropagation()}>
            <div className="cal__popup-head">{formatDayLong(activeDay)}</div>
            <div className="cal__popup-list" ref={listRef}>
              {dayEntries.map((ev, i) => (
                <button
                  key={(ev.jobId ?? 'mail') + ev.type + i}
                  className={'cal__entry' + (ev.jobId ? '' : ' cal__entry--nurmail')}
                  disabled={!ev.jobId}
                  onClick={ev.jobId ? () => onOpenJob(ev.jobId!) : undefined}
                  title={ev.jobId ? undefined : 'Aus Gmail — kein Job dazu im Bestand'}
                >
                  <span className="cal__entry__dot" style={{ background: CAL_COLOR[ev.type] }} />
                  {ev.type === 'followup' && <span className="cal__entry__quelle">Nachfass</span>}
                  <span className="cal__entry__firma">{ev.company}</span>
                  <span className="cal__entry__titel">{ev.title}</span>
                  {!ev.jobId && <span className="cal__entry__quelle">nur Mail</span>}
                </button>
              ))}
            </div>
            <div className="cal__popup-foot">← → Tag · ↑ ↓ scrollen · Esc</div>
          </div>
        </div>
      )}
    </>
  );
}

// Chip-Liste für Felder, die aus einer einzigen Textzeile bestehen: Suchbegriffe,
// Orte, Regionen. Kompakt, weil sieben Begriffe sonst sieben Zeilen Höhe kosten.
function ChipListe({ werte, hint, onChange, warnung }: {
  werte: string[];
  hint: string;
  onChange: (next: string[]) => void;
  warnung?: (wert: string) => string | null;
}) {
  const [entwurf, setEntwurf] = useState('');
  const [nachfrage, setNachfrage] = useState<string | null>(null);

  const uebernehmen = (wert: string, trotzWarnung = false) => {
    const w = wert.trim();
    if (!w || werte.includes(w)) { setEntwurf(''); return; }
    const warn = warnung?.(w);
    if (warn && !trotzWarnung) { setNachfrage(w); return; }
    onChange([...werte, w]);
    setEntwurf('');
    setNachfrage(null);
  };

  return (
    <div className="cfg__chips">
      {werte.map(w => (
        <span key={w} className="cfg__chip">
          {w}
          <button className="cfg__chip-x" onClick={() => onChange(werte.filter(x => x !== w))} aria-label={`${w} entfernen`}>×</button>
        </span>
      ))}
      <input
        className="cfg__add"
        value={entwurf}
        placeholder={hint}
        onChange={e => { setEntwurf(e.target.value); setNachfrage(null); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); uebernehmen(entwurf); } }}
        onBlur={() => { if (!nachfrage) uebernehmen(entwurf); }}
      />
      {nachfrage && (
        <div className="cfg__warn">
          <span>{warnung?.(nachfrage)}</span>
          <button className="btn" onClick={() => uebernehmen(nachfrage, true)}>Trotzdem eintragen</button>
          <button className="btn btn--ghost" onClick={() => { setNachfrage(null); setEntwurf(''); }}>Abbrechen</button>
        </div>
      )}
    </div>
  );
}

// Ein Portalblock. Die Form folgt der Feldzahl, nicht dem Portalnamen: ein Feld wird zur
// Chip-Wolke, mehrere werden zu beschrifteten Zeilen. Welche Form es ist, sagt das
// querySchema des Adapters — ein künftiges Portal ordnet sich damit von selbst ein.
function PortalBlock({ name, cfg, felder, onChange }: {
  name: string;
  cfg: { enabled: boolean; queries: Record<string, string>[] };
  felder: QueryField[];
  onChange: (next: { enabled: boolean; queries: Record<string, string>[] }) => void;
}) {
  const einfeldrig = felder.length === 1;
  const feld = felder[0];

  return (
    <div className={'cfg__portal' + (cfg.enabled ? '' : ' cfg__portal--aus')}>
      <div className="cfg__portal-kopf">
        <span className="cfg__portal-name">{name}</span>
        {/* Deaktivierte Portale bleiben sichtbar statt ausgeblendet — sonst verschwindet
            die Konfiguration mitsamt dem Weg, sie zurückzuholen. */}
        <label className="cfg__schalter">
          <input type="checkbox" checked={cfg.enabled} onChange={e => onChange({ ...cfg, enabled: e.target.checked })} />
          {cfg.enabled ? 'an' : 'aus'}
        </label>
      </div>

      {einfeldrig ? (
        <ChipListe
          werte={cfg.queries.map(q => q[feld.key] ?? '').filter(Boolean)}
          hint={`+ ${feld.label}`}
          onChange={next => onChange({ ...cfg, queries: next.map(v => ({ [feld.key]: v })) })}
        />
      ) : (
        <div className="cfg__zeilen">
          <div className="cfg__zeile cfg__zeile--kopf" style={{ gridTemplateColumns: `repeat(${felder.length}, 1fr) auto` }}>
            {felder.map(f => <span key={f.key}>{f.label}{f.required && ' *'}</span>)}
            <span />
          </div>
          {cfg.queries.map((q, i) => (
            <div key={i} className="cfg__zeile" style={{ gridTemplateColumns: `repeat(${felder.length}, 1fr) auto` }}>
              {felder.map(f => (
                <input
                  key={f.key}
                  className="cfg__feld"
                  value={q[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={e => onChange({
                    ...cfg,
                    queries: cfg.queries.map((x, xi) => (xi === i ? { ...x, [f.key]: e.target.value } : x)),
                  })}
                />
              ))}
              <button className="cfg__chip-x" aria-label={`Anfrage ${i + 1} entfernen`}
                onClick={() => onChange({ ...cfg, queries: cfg.queries.filter((_, xi) => xi !== i) })}>×</button>
            </div>
          ))}
          <button className="btn btn--ghost cfg__plus"
            onClick={() => onChange({ ...cfg, queries: [...cfg.queries, Object.fromEntries(felder.map(f => [f.key, ''])) ] })}>
            + Anfrage
          </button>
        </div>
      )}
    </div>
  );
}

// Das Roh-JSON ist eine ANSICHT, kein zweiter Editor: es zeigt, was das Formular gerade
// hält. Damit gibt es keine zweite Wahrheit, die mit der ersten in Konflikt geraten kann
// (siehe .scratch/einstellungsseite, Ticket "Formular und Roh-JSON").
function RohAnsicht({ offen, onToggle, data }: { offen: boolean; onToggle: () => void; data: unknown }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="cfg__roh">
      <button className="cfg__roh-kopf" onClick={onToggle} aria-expanded={offen}>
        <span className={'cal__caret' + (offen ? ' cal__caret--offen' : '')}>▸</span>
        Rohdaten (JSON)
        <span className="cfg__roh-hint">nur lesen · spiegelt das Formular</span>
      </button>
      {offen && (
        <>
          <pre className="cfg__roh-text">{text}</pre>
          <button className="btn btn--ghost" onClick={() => navigator.clipboard?.writeText(text)}>
            <Copy /> Kopieren
          </button>
        </>
      )}
    </div>
  );
}

// Hängt ein SSE-GridUnitEvent (eine fertige Zeile) an den bestehenden Sections-Baum an —
// von Scrape/Filter/Anschreiben gleichermaßen genutzt, damit die Anhänge-Logik nicht
// dreimal geschrieben wird.
function appendGridRow(sections: LoadGridSection[], e: GridUnitEvent): LoadGridSection[] {
  const row: LoadGridRow = { key: e.row, squares: e.items };
  const idx = sections.findIndex(s => s.key === e.section);
  if (idx === -1) return [...sections, { key: e.section, label: e.sectionLabel, rows: [row] }];
  const next = [...sections];
  next[idx] = { ...next[idx], rows: [...next[idx].rows, row] };
  return next;
}

export default function JobbotUI() {
  const [jobs, setJobs] = useState<JobWithBrief[]>([]);
  const [folder, setFolder] = useState<FolderId>('mail/entwurf');
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
  const [attachment, setAttachment] = useState<AttachmentMeta | null | undefined>(undefined);
  const [cc, setCc] = useState<string | null | undefined>(undefined);
  const [ccInput, setCcInput] = useState('');
  const [scrapeSources, setScrapeSources] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<FilterMode>('regex');
  const [filterScope, setFilterScope] = useState<'new' | 'all'>('new');
  // Entspricht scripts/run-anschreiben.ts --data (matched/offstack) — "brutal" ist als
  // Kästchen trotzdem wählbar (Symmetrie mit den Fit-Chips oben in der Liste), landet aber
  // serverseitig immer bei "skipped" (generateAnschreiben() lehnt fit "brutal" grundsätzlich
  // ab, siehe lib/anschreiben.ts). Default spiegelt den CLI-Default ohne --data: alle
  // getriagten Jobs außer brutal.
  const [anschreibenFits, setAnschreibenFits] = useState<Set<Fit>>(new Set(['matched', 'offstack']));
  const [anschreibenLimit, setAnschreibenLimit] = useState('');
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus | null>(null);
  const [scrapeSections, setScrapeSections] = useState<LoadGridSection[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterRunStatus | null>(null);
  const [filterSections, setFilterSections] = useState<LoadGridSection[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[] | null>(null);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [selectedDupKeys, setSelectedDupKeys] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [replyOnly, setReplyOnly] = useState(false);
  const [repliesFetching, setRepliesFetching] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [anschreibenStatus, setAnschreibenStatus] = useState<AnschreibenRunStatus | null>(null);
  const [anschreibenSections, setAnschreibenSections] = useState<LoadGridSection[]>([]);
  const [scrapeStarting, setScrapeStarting] = useState(false);
  const [filterStarting, setFilterStarting] = useState(false);
  const [anschreibenStarting, setAnschreibenStarting] = useState(false);
  // Auswahl für die "Anschreiben erstellen"-Aktion — nur im "jobs"-Ordner relevant
  // (matched/uncertain landen laut STATUS_MAP nirgendwo sonst), deshalb bei
  // Ordnerwechsel zurückgesetzt statt über Ordner hinweg mitzuschleppen.
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  // Eigene Auswahl statt selectedJobIds: die hängt am Ordner und wird bei jedem
  // Ordnerwechsel geleert — der Nachfass-Tab ist kein Ordner.
  const [followUpSelection, setFollowUpSelection] = useState<Set<string>>(new Set());
  const [followUpBusy, setFollowUpBusy] = useState(false);

  // Einstellungsseite "Suche". Zwei Dateien, zwei Zustände — sie werden getrennt
  // geladen und getrennt gespeichert (ein PUT je Datei, siehe lib/config-store.ts).
  const [schema, setSchema] = useState<Record<string, QueryField[]> | null>(null);
  const [sources, setSources] = useState<SourcesCfg | null>(null);
  const [umkreis, setUmkreis] = useState<LocationCfg | null>(null);
  const [cfgBackup, setCfgBackup] = useState<{ sources: boolean; location: boolean }>({ sources: false, location: false });
  const [cfgDirty, setCfgDirty] = useState<{ sources: boolean; location: boolean }>({ sources: false, location: false });
  const [cfgErrors, setCfgErrors] = useState<string[]>([]);
  const [cfgBusy, setCfgBusy] = useState(false);
  const [rohOffen, setRohOffen] = useState<Record<string, boolean>>({});
  // Sidebar-Ordner mit frisch generierten Anschreiben, die noch nicht angesehen wurden —
  // nur im Speicher (kein localStorage, bewusst so einfach wie möglich): ein Reload
  // löscht die Markierung, das ist unkritisch, weil die betroffenen Jobs im Ordner
  // ohnehin weiter sichtbar bleiben. Aus geht ausschließlich per Klick auf den Ordner.
  const [highlightFolders, setHighlightFolders] = useState<Set<FolderId>>(new Set());
  // Verhindert Toast/Refetch-Spam: der Server hält 'done' so lange, bis der
  // nächste Lauf startet — ohne diesen Merker würde jeder Poll-Tick (alle 1.5s)
  // erneut feiern, solange niemand einen neuen Lauf anstößt.
  const lastSeenScrapeRunId = useRef<string | null>(null);
  const lastSeenFilterRunId = useRef<string | null>(null);
  const lastSeenAnschreibenRunId = useRef<string | null>(null);
  // Weckt die Status-Poll-Schleife (siehe unten) sofort auf, statt auf den nächsten
  // 1.5s-Tick zu warten — gesetzt vom Poll-Effect, aufgerufen von runScrapeNow/
  // runFilterNow/runAnschreibenNow direkt nach dem Start-POST.
  const pollRunsNow = useRef<() => void>(() => {});
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

  useEffect(() => {
    fetch('/api/scrape/sources').then(r => r.json()).then((names: string[]) => {
      setScrapeSources(names);
      setSelectedSources(new Set(names));
    });
    fetch('/api/settings').then(r => r.json()).then((s: { filterMode: FilterMode }) => setFilterMode(s.filterMode));
  }, []);

  // Poll-Schleife für die gesamte Lebensdauer der App (nicht an eine bestimmte
  // Ansicht gebunden) — nur so bleibt die Fortschrittsanzeige in der Sidebar
  // sichtbar, auch wenn man zu einer anderen Ansicht wechselt. Läuft aber nur,
  // solange tatsächlich etwas läuft: selbst-planender setTimeout statt Dauer-
  // Intervall, hört auf sobald alle drei Status nicht mehr "running" sind.
  // runScrapeNow/runFilterNow/runAnschreibenNow wecken sie über pollRunsNow
  // sofort nach dem Start-POST wieder auf, statt auf den nächsten Tick zu warten.
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

        if ((s.status === 'done' || s.status === 'error') && s.runId && s.runId !== lastSeenScrapeRunId.current) {
          lastSeenScrapeRunId.current = s.runId;
          refetchJobs();
          say(
            s.status === 'error' ? `Scrape fehlgeschlagen: ${s.error}` : `Scrape: ${s.result?.newTotal ?? 0} neu, ${s.result?.skipTotal ?? 0} dedup`,
            s.status === 'error' ? 'err' : 'ok'
          );
        }
        if ((f.status === 'done' || f.status === 'error') && f.runId && f.runId !== lastSeenFilterRunId.current) {
          lastSeenFilterRunId.current = f.runId;
          refetchJobs();
          say(
            f.status === 'error' ? `Filter fehlgeschlagen: ${f.error}` : `Filter: ${f.result?.matched ?? 0} Match, ${f.result?.offstack ?? 0} Offstack, ${f.result?.brutal ?? 0} Brutal`,
            f.status === 'error' ? 'err' : 'ok'
          );
        }
        if ((a.status === 'done' || a.status === 'error' || a.status === 'stopped') && a.runId && a.runId !== lastSeenAnschreibenRunId.current) {
          lastSeenAnschreibenRunId.current = a.runId;
          refetchJobs();
          say(
            a.status === 'error' ? `Anschreiben fehlgeschlagen: ${a.error}`
            : a.status === 'stopped' ? `Anschreiben abgebrochen: ${a.result?.generated ?? 0} generiert, ${a.result?.emailsFound ?? 0} E-Mails gefunden`
            : `Anschreiben: ${a.result?.generated ?? 0} generiert, ${a.result?.skipped ?? 0} übersprungen, ${a.result?.emailsFound ?? 0} E-Mails gefunden`,
            a.status === 'error' ? 'err' : 'ok'
          );
          // Nur den Entwürfe-Ordner markieren, der wirklich einen neuen Job bekommen
          // hat — mailGenerated/nomailGenerated sind die Aufschlüsselung von `generated`
          // nach Mail-Status am Ende des Laufs (siehe lib/anschreiben-runner.ts).
          if (a.status !== 'error') {
            setHighlightFolders(prev => {
              const next = new Set(prev);
              if ((a.result?.mailGenerated ?? 0) > 0) next.add('mail/entwurf');
              if ((a.result?.nomailGenerated ?? 0) > 0) next.add('nomail/entwurf');
              return next;
            });
          }
        }

        const stillRunning = s.status === 'running' || f.status === 'running' || a.status === 'running';
        if (!cancelled && stillRunning) timeoutId = setTimeout(tick, 1500);
      } catch {
        // Server kurz nicht erreichbar — weiter versuchen statt die Schleife stillschweigend zu beenden
        if (!cancelled) timeoutId = setTimeout(tick, 1500);
      }
    };
    pollRunsNow.current = tick;
    tick();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [refetchJobs, say]);

  // SSE statt Polling fürs Anschreiben-Lade-Grid — ein Event pro fertigem (oder
  // fehlgeschlagenem) Anschreiben, angehängt an anschreibenSections (siehe
  // appendGridRow). Eine einzige, dauerhaft offene Verbindung (wie das Poll-Intervall
  // oben), damit das Grid auch beim Ansichtswechsel weiterwächst.
  useEffect(() => {
    const es = new EventSource('/api/anschreiben/stream');
    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as GridUnitEvent;
      setAnschreibenSections(prev => appendGridRow(prev, event));
    };
    return () => es.close();
  }, []);

  // Wie oben, fürs Scrape-Lade-Grid — ein Event pro fertiger Seite/Batch je Quelle
  // (siehe scripts/ui-server.ts onUnitDone).
  useEffect(() => {
    const es = new EventSource('/api/scrape/stream');
    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as GridUnitEvent;
      setScrapeSections(prev => appendGridRow(prev, event));
      // Tschobbo-Hook (ui/tschobbo.js): nur wenn das Scrape-Grid gerade sichtbar
      // ist, sonst gäbe es keine echten Quadrat-Positionen zum Anfassen. Einzige
      // Stelle, die das Event feuert — Filter/Anschreiben bekämen später denselben
      // Einzeiler in ihren Effects, ohne Tschobbo selbst anzufassen.
      if (viewRef.current === 'scrape') window.dispatchEvent(new CustomEvent('tschobbo:unit', { detail: event }));
    };
    return () => es.close();
  }, []);

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

  // Wie oben, fürs Filter-Lade-Grid — ein Event pro fertigem 10er-Batch je
  // Ergebnis-Kategorie (Match/Offstack/Brutal, siehe scripts/ui-server.ts).
  useEffect(() => {
    const es = new EventSource('/api/filter/stream');
    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as GridUnitEvent;
      setFilterSections(prev => appendGridRow(prev, event));
    };
    return () => es.close();
  }, []);

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
      pollRunsNow.current();
    } finally {
      setScrapeStarting(false);
    }
  }

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
      pollRunsNow.current();
    } finally {
      setFilterStarting(false);
    }
  }

  const loadDuplicates = useCallback(() => {
    setDuplicatesLoading(true);
    fetch('/api/duplicates')
      .then(r => r.json())
      .then((groups: DuplicateGroup[]) => setDuplicateGroups(groups))
      .finally(() => setDuplicatesLoading(false));
  }, []);

  async function fetchReplies() {
    setRepliesFetching(true);
    try {
      const res = await fetch('/api/mail/replies/fetch', { method: 'POST' });
      const data = await res.json() as { checked?: number; matched?: number; error?: string };
      if (!res.ok) { say(`Antworten-Abruf fehlgeschlagen: ${data.error}`, 'err'); return; }
      say(`Antworten-Abruf: ${data.matched ?? 0} von ${data.checked ?? 0} Mails zugeordnet`, 'ok');
      if ((data.matched ?? 0) > 0) refetchJobs();
    } catch (err) {
      say(`Antworten-Abruf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setRepliesFetching(false);
    }
  }

  // Trägt sentAt/replyReceivedAt nach, die im Job-JSON fehlen — read-only gegenüber
  // Gmail, füllt nur Lücken (siehe POST /api/gmail-sync). Läuft synchron durch zwei
  // IMAP-Ordner, kann bei großem Postfach also dauern; deshalb der Fetching-Zustand.
  async function syncGmail() {
    setGmailSyncing(true);
    try {
      const res = await fetch('/api/gmail-sync', { method: 'POST' });
      const data = await res.json() as {
        sentGescannt?: number; markiert?: number; sentGefuellt?: number; ohneJob?: number;
        replyGescannt?: number; replyGefuellt?: number; seit?: string; error?: string;
      };
      if (!res.ok) { say(`Gmail-Sync fehlgeschlagen: ${data.error}`, 'err'); return; }
      // Jede Stufe einzeln melden (gelesen → markiert → zugeordnet): ein blankes
      // "0 ergänzt" ließe offen, ob das Postfach leer war, das Label fehlt oder die
      // Zuordnung nichts fand — drei völlig verschiedene Ursachen.
      say(
        `Gmail-Sync ab ${data.seit ?? HISTORY_START}: ${data.sentGescannt ?? 0} gesendet gelesen, `
        + `${data.markiert ?? 0} als Bewerbung markiert → ${data.sentGefuellt ?? 0} Jobs verknüpft, `
        + `${data.ohneJob ?? 0} nur Mail · ${data.replyGefuellt ?? 0} Antworten`,
        'ok'
      );
      if ((data.sentGefuellt ?? 0) > 0 || (data.replyGefuellt ?? 0) > 0) {
        refetchJobs();
        fetch('/api/calendar').then(r => r.json()).then(setCalendarEvents);
      }
    } catch (err) {
      say(`Gmail-Sync fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setGmailSyncing(false);
    }
  }

  // Nur beim Betreten der Ansicht laden (kein Polling wie bei Scrape/Filter/Anschreiben)
  // — Duplikatsuche ist eine synchrone, sofort fertige Leseoperation ohne Fortschritt,
  // der sich zu beobachten lohnt.
  useEffect(() => {
    if (view === 'duplicates') loadDuplicates();
  }, [view, loadDuplicates]);

  // Wie Duplikate: nur beim Betreten laden, kein Polling — der Kalender liest einen
  // Snapshot, keinen laufenden Prozess.
  useEffect(() => {
    if (view === 'calendar') fetch('/api/calendar').then(r => r.json()).then(setCalendarEvents);
  }, [view]);

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

  // Ein Aufruf für beides: die Mehrfachauswahl in der Liste UND den einzelnen
  // "Neu generieren"-Button im Detail (der bisher ein reiner Toast-Stub war,
  // ohne irgendetwas anzustoßen) — beide wollen dieselbe Aktion für eine Menge
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
      else setSelectedJobIds(new Set());
      pollRunsNow.current();
    } finally {
      setAnschreibenStarting(false);
    }
  }

  async function stopAnschreibenNow() {
    const res = await fetch('/api/anschreiben/stop', { method: 'POST' });
    if (res.status === 409) say('Kein Anschreiben-Lauf aktiv', 'err');
    // Erfolgsfall zeigt sich am Poll-Tick (status wechselt auf "stopped", eigener Toast
    // dort) — kein zweiter Toast hier, der nur den Lauf-Abschluss vorwegnehmen würde.
  }

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

  useEffect(() => {
    if (view !== 'attachment') return;
    fetch('/api/attachment')
      .then(r => (r.ok ? r.json() : null))
      .then(setAttachment);
  }, [view]);

  async function uploadAttachment(file: File) {
    const res = await fetch('/api/attachment', { method: 'POST', body: file });
    const body = await res.json().catch(() => null);
    if (res.ok) { setAttachment(body); say('Anhang hochgeladen'); }
    else say(body?.error ?? 'Upload fehlgeschlagen', 'err');
  }

  async function removeAttachment() {
    await fetch('/api/attachment', { method: 'DELETE' });
    setAttachment(null);
    say('Anhang entfernt');
  }

  useEffect(() => {
    if (view !== 'cc') return;
    fetch('/api/cc')
      .then(r => r.json())
      .then((d: { email: string | null }) => { setCc(d.email); setCcInput(d.email ?? ''); });
  }, [view]);

  async function saveCcNow(email: string) {
    const res = await fetch('/api/cc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) { setCc(body.email); say('CC gespeichert'); }
    else say(body?.error ?? 'Speichern fehlgeschlagen', 'err');
  }

  async function removeCc() {
    await fetch('/api/cc', { method: 'DELETE' });
    setCc(null);
    setCcInput('');
    say('CC entfernt');
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
  // Server-Schreiben unten. Es gibt bewusst keinen Weg, patch() direkt aus einem
  // Button-Handler aufzurufen: jede Statusmaschinen-Aktion geht zuerst über den
  // Server (pessimistisches Update) — sonst zeigt die UI einen Status, den die
  // Job-JSON gar nicht hat, und genau das war über diese ganze Migration hinweg
  // das eine, was nicht passieren darf (siehe postausgang/gesendet-Unterscheidung).
  const patch = (id: string, p: Partial<JobWithBrief>) =>
    setJobs(js => js.map(j => (j.id === id ? { ...j, ...p } : j)));

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

  // Beim Betreten der Seite laden, nicht beim Start — wie Duplikate und Kalender auch.
  // Das Schema kommt aus der Adapter-Registry (GET /api/config/schema), nicht aus der
  // Datei: der Code sagt, welche Portale es gibt und welche Felder sie kennen.
  useEffect(() => {
    if (view !== 'suche') return;
    let abgebrochen = false;
    (async () => {
      const [sch, src, loc] = await Promise.all([
        fetch('/api/config/schema').then(r => r.json()),
        fetch('/api/config/sources').then(r => r.json()),
        fetch('/api/config/location').then(r => r.json()),
      ]);
      if (abgebrochen) return;
      setSchema(sch as Record<string, QueryField[]>);
      setSources(src.data as SourcesCfg);
      setUmkreis(loc.data as LocationCfg);
      setCfgBackup({ sources: !!src.hasBackup, location: !!loc.hasBackup });
      setCfgDirty({ sources: false, location: false });
      setCfgErrors([]);
    })();
    return () => { abgebrochen = true; };
  }, [view]);

  async function saveConfig(name: 'sources' | 'location') {
    const data = name === 'sources' ? sources : umkreis;
    if (!data) return;
    setCfgBusy(true);
    setCfgErrors([]);
    try {
      const res = await fetch(`/api/config/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) { setCfgErrors(body.errors ?? ['Speichern fehlgeschlagen']); return; }
      setCfgDirty(d => ({ ...d, [name]: false }));
      setCfgBackup(b => ({ ...b, [name]: true }));
      // loadSources() liest pro Nutzung frisch — ein laufender Scrape sieht die Änderung
      // mitten drin. Gesperrt wird nicht, aber ungesagt bleiben soll es auch nicht.
      say(body.scrapeRunning ? 'Gespeichert — ein Scrape läuft gerade und sieht die Änderung noch' : 'Gespeichert');
    } finally {
      setCfgBusy(false);
    }
  }

  async function restoreConfig(name: 'sources' | 'location') {
    setCfgBusy(true);
    try {
      const res = await fetch(`/api/config/${name}/restore`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) { say(body.error ?? 'Zurückholen fehlgeschlagen', 'err'); return; }
      if (name === 'sources') setSources(body.data as SourcesCfg); else setUmkreis(body.data as LocationCfg);
      setCfgBackup(b => ({ ...b, [name]: false }));
      setCfgDirty(d => ({ ...d, [name]: false }));
      setCfgErrors([]);
      say('Letzte Fassung zurückgeholt');
    } finally {
      setCfgBusy(false);
    }
  }

  // Anfragen, die kein Adapter annehmen würde. Zwei Quellen: Handedits an der Datei —
  // dafür war der Hinweis ursprünglich gedacht — und Tippen im Formular selbst, etwa eine
  // frisch angelegte Zeile mit leerem Pflichtfeld. Deshalb hängt daran auch der
  // Speichern-Knopf: die Rückmeldung kommt beim Tippen, nicht erst als 422 vom Server.
  //
  // "Reparieren" wird nur angeboten, wenn die Absicht eindeutig ist: genau ein
  // unbekannter Schlüssel und genau ein fehlendes Pflichtfeld heisst Tippfehler im
  // Namen, der Wert soll bleiben. Alles andere waere Raten.
  const kaputteAnfragen = useMemo(() => {
    if (!sources || !schema) return [];
    const treffer: { portal: string; index: number; problem: string; fix?: { von: string; nach: string } }[] = [];
    for (const [portal, cfg] of Object.entries(sources)) {
      const felder = schema[portal];
      if (!felder) continue;
      cfg.queries.forEach((q, i) => {
        const probleme = checkQuery(felder, q);
        if (probleme.length === 0) return;
        const fehlend = probleme.filter(p => p.kind === 'missing');
        const unbekannt = probleme.filter(p => p.kind === 'unknown');
        treffer.push({
          portal, index: i,
          problem: probleme.map(describeProblem).join('; '),
          fix: fehlend.length === 1 && unbekannt.length === 1
            ? { von: unbekannt[0].key, nach: fehlend[0].key }
            : undefined,
        });
      });
    }
    return treffer;
  }, [sources, schema]);

  const sourcesFehlerhaft = kaputteAnfragen.length > 0;

  // Benennt einen Schlüssel um und behält den Wert — der Tippfehler-Fall.
  function repariereAnfrage(portal: string, index: number, von: string, nach: string) {
    setSources(prev => {
      if (!prev) return prev;
      const queries = prev[portal].queries.map((q, qi) => {
        if (qi !== index) return q;
        const { [von]: wert, ...rest } = q;
        return { ...rest, [nach]: wert };
      });
      return { ...prev, [portal]: { ...prev[portal], queries } };
    });
    setCfgDirty(d => ({ ...d, sources: true }));
  }

  // Fällige Nachfassen. Die Regel lebt in lib/followup.ts, damit sie testbar ist und
  // nicht zwischen Server und UI auseinanderdriftet.
  const faellig = useMemo(() => dueFollowUps(jobs), [jobs]);

  // Sammelaktion, ausdrücklich so gewollt: "all masse nicht alles einzeln klicken".
  // Sequentiell statt Promise.all — anders als beim Statuspatch geht hier je Job eine
  // echte IMAP/SMTP-Verbindung raus, die parallel zu Rate-Limits bei Gmail führt.
  async function runFollowUps(via: 'draft' | 'sent') {
    const ids = [...followUpSelection];
    if (ids.length === 0) return;
    setFollowUpBusy(true);
    let ok = 0;
    let letzterFehler = '';
    for (const id of ids) {
      try {
        const res = await fetch(`/api/jobs/${id}/followup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ via }),
        });
        if (!res.ok) { letzterFehler = ((await res.json()) as { error?: string }).error ?? 'Fehler'; continue; }
        const updated = (await res.json()) as JobWithBrief;
        patch(id, { followUps: updated.followUps });
        ok++;
      } catch (err) {
        letzterFehler = err instanceof Error ? err.message : String(err);
      }
    }
    setFollowUpBusy(false);
    setFollowUpSelection(new Set());
    const verb = via === 'sent' ? 'gesendet' : 'als Entwurf angelegt';
    if (ok === ids.length) say(`${ok} Nachfass ${verb}`);
    else say(`${ok} von ${ids.length} ${verb} — ${letzterFehler}`, 'err');
  }

  // "Entwurf erzeugen" heißt: echten Gmail-Entwurf per IMAP anlegen
  // (POST /api/jobs/:id/draft, siehe ui-server.ts), nicht bloß den Status umbiegen —
  // sonst würde die UI "postausgang" behaupten, ohne dass in Gmail je ein Entwurf
  // liegt. Status kommt hier von der Server-Antwort, nicht optimistisch gesetzt.
  async function createDraft(id: string, email: string) {
    const res = await fetch(`/api/jobs/${id}/draft`, { method: 'POST' });
    if (res.ok) {
      patch(id, { status: 'postausgang' });
      say(`Entwurf für ${email} erstellt`);
      setDetailOpen(false);
    } else {
      const body = await res.json().catch(() => null);
      say(body?.error ?? 'Entwurf fehlgeschlagen', 'err');
    }
  }

  // "Direkt senden" ist die zweite Gabel neben "Entwurf erzeugen": SMTP-Versand
  // ohne Zwischenstopp in Gmail-Entwürfen (POST /api/jobs/:id/send). Getrennter
  // Button statt Parameter am bestehenden, weil beide Pfade zu unterschiedlichen
  // Status-Endpunkten führen (postausgang vs. gesendet) und das im UI sichtbar
  // zwei bewusste Aktionen sind, keine Variante derselben.
  async function sendDirect(id: string) {
    const res = await fetch(`/api/jobs/${id}/send`, { method: 'POST' });
    if (res.ok) {
      patch(id, { status: 'gesendet' });
      say('Gesendet');
      setDetailOpen(false);
    } else {
      const body = await res.json().catch(() => null);
      say(body?.error ?? 'Versand fehlgeschlagen', 'err');
    }
  }

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
                {shown.email ? (
                  <span className="dt__mail">{shown.email}</span>
                ) : (
                  <span className="dt__nomail">Keine Adresse im Inserat — Bewerbung übers Portal</span>
                )}
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
