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
} from 'lucide-react';
import type { Job, Fit } from '../scrapers/interface.ts';
import { FOLDER_IDS, inFolder, type FolderId } from '../lib/folders.ts';

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
 * als Streifen von Urteilen, bevor du ein Wort gelesen hast.
 * Rot ist exklusiv für Fehler reserviert, deshalb ist "brutal" Stahl
 * und nicht Rot: die Zeile soll zurücktreten, nicht schreien.
 *
 * Tiefe = 4 Stufen Elevation: ink < slate < panel < paper.
 * Das Anschreiben ist die einzige helle Fläche der App — weil es das
 * einzige ist, das die App verlässt.
 * ------------------------------------------------------------------ */

const FIT: Record<Fit, { label: string; color: string }> = {
  match: { label: 'Match', color: '#35D0A5' },
  offstack: { label: 'Offstack', color: '#E8B04B' },
  brutal: { label: 'Brutal', color: '#5F6875' },
};

// fit ist nullable (scrapers/interface.ts) und bekommt bewusst KEINEN Default — ein
// grob geratener Fit sieht identisch aus wie ein echtes Urteil und ist damit
// schlimmer als gar keiner (71 Jobs wurden absichtlich nicht auf "match" geraten).
// null bekommt eine neutrale Haarlinie statt einer der drei Urteilsfarben.
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
  --err:#E5484D;
  --sans:'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --mono:'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;
  --serif:'IBM Plex Serif', Georgia, serif;

  position:fixed; inset:0;
  display:grid; grid-template-columns:236px 372px 1fr;
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

.chips { display:flex; gap:5px; padding:10px 0; overflow-x:auto; scrollbar-width:none; }
.chips::-webkit-scrollbar { display:none; }
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

.row {
  position:relative; width:100%; display:block; text-align:left;
  padding:11px 12px 11px 18px; border-bottom:1px solid var(--line-soft);
}
.row:hover { background:var(--raised); }
.row--on { background:var(--raised); }
.row--on::after { content:''; position:absolute; right:0; top:0; bottom:0; width:2px; background:var(--text); }
.row--dim { opacity:.58; }
.row--dim:hover, .row--dim.row--on { opacity:1; }
.rail { position:absolute; left:0; top:0; bottom:0; width:3px; }

.row__l1 { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }
.row__firma { font-weight:600; font-size:13px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row__age { font-family:var(--mono); font-size:10.5px; color:var(--dim); flex:none; font-variant-numeric:tabular-nums; }
.row__titel { font-size:12.5px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-bottom:4px; }
.row__snip { font-size:11.5px; color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row__meta { display:flex; align-items:center; gap:7px; margin-top:6px; }
.tag {
  font-family:var(--mono); font-size:9.5px; letter-spacing:.04em;
  padding:1px 5px; border-radius:3px; border:1px solid var(--line); color:var(--dim);
}
.tag--nomail { border-style:dashed; }
.tag--err { border-color:rgba(229,72,77,.4); color:var(--err); }

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

.bar { display:flex; align-items:center; gap:8px; padding:12px 24px; border-top:1px solid var(--line-soft); background:var(--slate); }
.btn { display:flex; align-items:center; gap:6px; padding:6px 13px; border-radius:5px; border:1px solid var(--line); color:var(--muted); font-size:12.5px; }
.btn:hover { border-color:var(--dim); color:var(--text); }
.btn svg { width:13px; height:13px; }
.btn--primary { background:var(--text); color:var(--ink); border-color:var(--text); font-weight:600; }
.btn--primary:hover { background:#fff; border-color:#fff; color:var(--ink); }
.btn--ghost { border-color:transparent; }
.btn--danger:hover { border-color:rgba(229,72,77,.5); color:var(--err); }
.bar__spacer { flex:1; }
.bar__hint { font-family:var(--mono); font-size:10.5px; color:var(--dim); }

.toast {
  position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
  background:var(--raised); border:1px solid var(--line); border-radius:6px;
  padding:8px 15px; font-size:12.5px; box-shadow:0 8px 24px rgba(0,0,0,.5); z-index:50;
}

@media (prefers-reduced-motion:no-preference) {
  .toast { animation:rise .16s ease-out; }
  @keyframes rise { from { opacity:0; transform:translate(-50%,6px); } }
}

/* ---------- Responsive ---------- */
@media (max-width:1180px) { .jb { grid-template-columns:208px 320px 1fr; } }
@media (max-width:960px) {
  .jb { grid-template-columns:1fr; }
  .sb { display:none; }
  .ls { border-right:none; }
  .dt { display:none; }
  .jb--detail .ls { display:none; }
  .jb--detail .dt { display:flex; }
  .dt__back { display:flex; align-items:center; gap:5px; padding:11px 16px 0; color:var(--muted); font-size:12.5px; }
  .dt__back svg { width:14px; height:14px; }
  .dt__head, .dt__body, .tabs, .bar { padding-left:16px; padding-right:16px; }
  .paper { padding:24px 22px; }
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
  const [folder, setFolder] = useState<FolderId>('mail/entwurf');
  const [fit, setFit] = useState<Fit | 'alle' | 'unbewertet'>('alle');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<'brief' | 'inserat'>('brief');
  const [toast, setToast] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/jobs')
      .then(r => r.json())
      .then((data: JobWithBrief[]) => setJobs(data));
  }, []);

  const say = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1900);
  }, []);

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
      .sort((a, b) => daysAgo(a.scrapedAt) - daysAgo(b.scrapedAt));
  }, [inCurrentFolder, fit, q]);

  const job = jobs.find(j => j.id === sel) ?? null;
  const shown = list.some(j => j.id === sel) ? job : null;

  useEffect(() => {
    if (!list.some(j => j.id === sel)) setSel(list[0]?.id ?? null);
  }, [list, sel]);

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
    if (!res.ok) { say('Speichern fehlgeschlagen'); return; }
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
    else say('Speichern fehlgeschlagen');
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
      say(body?.error ?? 'Entwurf fehlgeschlagen');
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
      say(body?.error ?? 'Versand fehlgeschlagen');
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
      .catch(() => say('Speichern fehlgeschlagen'));
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

  return (
    <div className={'jb' + (detailOpen ? ' jb--detail' : '')}>
      <style>{CSS}</style>

      {/* ---------- Sidebar ---------- */}
      <nav className="sb">
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
                    setFolder(f.id);
                    setFit('alle');
                  }}
                >
                  <f.icon />
                  <span className="fld__label">{f.label}</span>
                  <span className="fld__n">{counts[f.id] ?? 0}</span>
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}

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
            {(['alle', 'match', 'offstack', 'brutal', 'unbewertet'] as const).map(k => (
              <button key={k} className={'chip' + (fit === k ? ' chip--on' : '')} onClick={() => setFit(k)}>
                {k !== 'alle' && <span className="chip__dot" style={{ background: k === 'unbewertet' ? 'var(--line)' : FIT[k].color }} />}
                {k === 'alle' ? 'Alle' : k === 'unbewertet' ? 'Unbewertet' : FIT[k].label}
                <span className="chip__n">{fitCounts[k]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ls__scroll">
          {list.length === 0 ? (
            <div className="empty">
              <div className="empty__h">Nichts hier</div>
              {q ? 'Suche anpassen oder Filter zurücksetzen.' : 'Alles abgearbeitet.'}
            </div>
          ) : (
            list.map(j => (
              <button
                key={j.id}
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
                </span>
              </button>
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

              {tab === 'brief' ? (
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
                    Der Lauf ist vor der Generierung abgebrochen. Fehler oben beheben, dann neu
                    generieren.
                  </div>
                )
              ) : (
                <div className="inserat">
                  <h4>Inserat · {shown.source}</h4>
                  {decodeEntities(shown.description)}
                </div>
              )}
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
                <button className="btn btn--ghost" onClick={() => say('Generierung angestoßen')}>
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<JobbotUI />);
