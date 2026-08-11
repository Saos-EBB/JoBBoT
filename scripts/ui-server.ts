import { createServer, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createStorage } from '../storage/index.ts';
import { config } from '../config.ts';
import { jobBasename } from '../lib/slugify.ts';
import { loadProfile } from '../lib/profile.ts';
import { composeEmail, createDraft, sendMail, logMailAction, fetchInboxReplies, fetchSentMails, istBewerbung, type ComposedEmail, type SentMail } from '../mail/gmail.ts';
import { matchReplies, matchSent } from '../lib/mail-match.ts';
import { HISTORY_START } from '../lib/calendar.ts';
import { loadMailEvents, saveMailEvents, toMailEvents } from '../lib/mail-events.ts';
import { ATTACHMENT_PATH, ATTACHMENT_FILENAME } from '../lib/attachment.ts';
import { loadCc, saveCc, clearCc } from '../lib/cc.ts';
import { loadSources } from '../lib/sources.ts';
import { loadSettings, type FilterMode } from '../lib/settings.ts';
import { buildScrapeSetup } from '../lib/scrape-setup.ts';
import { runScrape } from '../lib/scrape-runner.ts';
import { filterJob } from '../lib/filter.ts';
import { createBatcher } from '../lib/grid-batch.ts';
import { findDuplicates, planMerge } from '../lib/duplicates.ts';
import { canGenerateAnschreiben } from '../lib/folders.ts';
import { runAnschreiben } from '../lib/anschreiben-runner.ts';
import type { Job, JobStatus } from '../scrapers/interface.ts';

function portFromArgs(): string | undefined {
  const flag = process.argv.find(a => a === '--port' || a.startsWith('--port='));
  if (!flag) return undefined;
  if (flag.includes('=')) return flag.split('=')[1];
  return process.argv[process.argv.indexOf(flag) + 1];
}

const PORT = Number(portFromArgs() ?? process.env.UI_PORT ?? 3000);
const STATUSES: JobStatus[] = ['new', 'triaged', 'generated', 'freigegeben', 'postausgang', 'gesendet', 'geloescht', 'fehler'];
const storage = createStorage();
const profile = loadProfile();

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// ---------- Scrape/Filter run state (in-memory, Prozesslebensdauer) ----------
// Kein Persistieren auf Disk: Einzelnutzer-Lokaltool, ein Server-Neustart mitten
// im Lauf verliert den Fortschritt (akzeptiert) — der Client erkennt das daran,
// dass der Status auf 'idle' statt 'done'/'error' zurückfällt (siehe Client-Poll).
interface ScrapeRunState {
  status: 'idle' | 'running' | 'done' | 'error';
  runId: string | null;
  sources: Record<string, { current: number; total: number }>;
  result?: { newTotal: number; skipTotal: number; perSource: { name: string; ok: boolean; newCount: number; skipCount: number; error?: string }[] };
  error?: string;
}
interface FilterRunState {
  status: 'idle' | 'running' | 'done' | 'error';
  runId: string | null;
  current?: { i: number; total: number; title: string };
  result?: { matched: number; offstack: number; brutal: number };
  error?: string;
}
interface AnschreibenRunState {
  status: 'idle' | 'running' | 'done' | 'error' | 'stopped';
  runId: string | null;
  current?: { i: number; total: number; title: string };
  result?: { generated: number; skipped: number; emailsFound: number; mailGenerated: number; nomailGenerated: number };
  error?: string;
}
let scrapeRun: ScrapeRunState = { status: 'idle', runId: null, sources: {} };
let filterRun: FilterRunState = { status: 'idle', runId: null };
let anschreibenRun: AnschreibenRunState = { status: 'idle', runId: null };
// Nur für Anschreiben abbrechbar (Scrape/Filter sind schnell genug, dass ein Stop-Button
// bisher niemand vermisst hat) — ein einzelner Lauf gleichzeitig, wie anschreibenRun selbst.
let anschreibenAbort: AbortController | null = null;

// SSE statt Polling fürs Lade-Grid: der Server ist plain node:http ohne Build-Step,
// SSE braucht dafür nur einen offen gehaltenen Response-Stream (kein zusätzliches
// Protokoll/Library) — einfacher als Chunked-Transfer selbst zu parsen. Die
// vorhandene /status-Route bleibt für den restlichen (i/total-)Zustand nutzbar.
// Payload ist jetzt "Einheit fertig + ihre Items" statt Prozent-/Phasen-Fortschritt —
// ein Event pro abgeschlossener Zeile (Seite/Batch/Anschreiben-Item), das Frontend
// hängt die Zeile an (siehe ui/app.tsx LoadGrid). Kein Snapshot beim (Re-)Connect —
// Einzelnutzer-Lokaltool, ein mittendrin verbundener Client sieht nur ab da (siehe
// scrapeRun/filterRun/anschreibenRun: ein Server-Neustart verliert genauso).
interface GridSquare { id: string; tooltip: string; state: 'done' | 'error' | 'excluded' | 'matched' | 'offstack' | 'brutal'; url?: string }
interface GridUnitEvent { section: string; sectionLabel: string; row: string; items: GridSquare[] }

function createSseChannel<T>() {
  const clients = new Set<ServerResponse>();
  function broadcast(payload: T): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) client.write(data);
  }
  return { clients, broadcast };
}

const anschreibenSse = createSseChannel<GridUnitEvent>();
const scrapeSse = createSseChannel<GridUnitEvent>();
const filterSse = createSseChannel<GridUnitEvent>();
// Zeilen-Zähler pro Quelle, nur für eindeutige Grid-Row-Keys — bei jedem neuen
// Scrape-Lauf zurückgesetzt (siehe POST /api/scrape).
let scrapeRowCounters: Record<string, number> = {};
let filterRowCounters = { matched: 0, offstack: 0, brutal: 0 };

// Whitelist statt generischem File-Server — ui-server.ts liefert sonst nur die
// eine hartkodierte /app.js-Route (aus ui/dist/), kein Static-Handler existiert
// bereits (siehe docs/architecture.md, Tschobbo-Entscheidung 2). Feste Pfade,
// kein Verzeichnis-Traversal möglich.
const TSCHOBBO_ASSETS = new Map<string, { path: string; type: string }>([
  ['/tschobbo-sheet.png', { path: join(import.meta.dirname, '..', 'ui', 'tschobbo-sheet.png'), type: 'image/png' }],
  ['/tschobbo-blobs.png', { path: join(import.meta.dirname, '..', 'ui', 'tschobbo-blobs.png'), type: 'image/png' }],
  ['/tschobbo.js', { path: join(import.meta.dirname, '..', 'ui', 'tschobbo.js'), type: 'text/javascript; charset=utf-8' }],
]);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function layout(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>JoBBoT</title>
<style>
:root {
  --paper: #f6f7fb; --paper-raised: #ffffff; --ink: #1b1f2a; --muted: #5b6272; --line: #dfe2ea;
  --accent: #4338ca; --accent-ink: #ffffff; --success: #15803d; --success-bg: #e8f5ec;
  --danger: #b91c1c; --danger-bg: #fbe9e9; --amber: #92400e; --amber-bg: #fdf1de;
  --sans: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono: ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #12141c; --paper-raised: #1a1d27; --ink: #e6e8f0; --muted: #9aa0b4; --line: #2a2e3b;
    --accent: #818cf8; --accent-ink: #12141c; --success: #4ade80; --success-bg: #16281d;
    --danger: #f87171; --danger-bg: #2c1616; --amber: #fbbf6a; --amber-bg: #2c2210;
  }
}
* { box-sizing: border-box; }
body { font-family: var(--sans); background: var(--paper); color: var(--ink); max-width: 720px; margin: 2.5rem auto; padding: 0 1.25rem 6rem; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
h1 { font-size: 1.7rem; margin: 0.2rem 0 0; } h3 { font-size: 1.05rem; margin: 2.2rem 0 0.7rem; }
.meta-label { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--paper-raised); border: 1px solid var(--line); padding: 1rem; border-radius: 6px; }
form { margin-top: 1rem; }
select, input[type="email"] { font-family: var(--sans); font-size: 0.9rem; color: var(--ink); background: var(--paper-raised); border: 1px solid var(--line); border-radius: 6px; padding: 0.4rem 0.6rem; }
button { font-family: var(--sans); font-size: 0.88rem; font-weight: 600; cursor: pointer; border-radius: 6px; padding: 0.45rem 0.85rem; border: 1px solid var(--line); background: transparent; color: var(--ink); }
button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
button.danger { background: var(--danger); color: #fff; border-color: transparent; }
.mail-card { background: var(--paper-raised); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 10px; padding: 1.1rem 1.3rem 1.3rem; margin-top: 0.7rem; display: flex; flex-direction: column; gap: 1rem; }
.field-row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.field-row input[type="email"] { flex: 1; min-width: 220px; font-family: var(--mono); }
.letter { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; font-family: var(--mono); font-size: 0.82rem; line-height: 1.6; overflow-x: auto; }
.letter dl { margin: 0; padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.6rem; }
.letter dt { color: var(--muted); } .letter dd { margin: 0; }
.letter .body { padding: 0.9rem; white-space: pre-wrap; }
.action-row { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.action-hint { font-size: 0.78rem; color: var(--muted); }
.locked { background: var(--paper); border: 1px dashed var(--line); border-radius: 8px; padding: 0.9rem 1rem; color: var(--muted); font-size: 0.88rem; margin-top: 0.7rem; }
.empty-email { background: var(--amber-bg); color: var(--amber); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.88rem; margin-top: 0.7rem; }
.banner-error { background: var(--danger-bg); color: var(--danger); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.88rem; margin-top: 1rem; }
.banner-done { background: var(--success-bg); color: var(--success); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.88rem; margin-top: 0.7rem; }
</style></head><body>${body}</body></html>`;
}

async function readCoverLetter(job: { title: string; company: string; postedAt?: string | null; scrapedAt: string; id: string }): Promise<string | null> {
  try {
    return await readFile(join(config.anschreibenDir, `${jobBasename(job)}.md`), 'utf8');
  } catch {
    return null;
  }
}

function renderLetter(email: ComposedEmail): string {
  return `<div class="letter">
    <dl><dt>An</dt><dd>${esc(email.to)}</dd><dt>Betreff</dt><dd>${esc(email.subject)}</dd></dl>
    <div class="body">${esc(email.text)}</div>
  </div>`;
}

async function renderMailSection(job: Job, error: string | null): Promise<string> {
  const errorBanner = error ? `<div class="banner-error">${esc(error)}</div>` : '';

  if (job.status === 'gesendet') {
    return `<h3>E-Mail</h3><div class="banner-done">Gesendet an ${esc(job.email ?? '')}.</div>${errorBanner}`;
  }
  if (job.status === 'postausgang') {
    return `<h3>E-Mail</h3><div class="banner-done">Als Gmail-Entwurf gespeichert (an ${esc(job.email ?? '')}). Versand erfolgt manuell in Gmail.</div>${errorBanner}`;
  }
  if (job.status !== 'freigegeben') {
    return `<h3>E-Mail</h3><div class="locked">Versand gesperrt, bis der Status auf <code>freigegeben</code> gesetzt ist.</div>${errorBanner}`;
  }

  const emailForm = `<form class="field-row" method="post" action="/job/${job.id}/email">
    <label for="mail-to">an</label>
    <input id="mail-to" name="email" type="email" value="${esc(job.email ?? '')}" placeholder="bewerbung@firma.at" required />
    <button type="submit">Speichern</button>
  </form>`;

  if (!job.email) {
    return `<h3>E-Mail</h3><div class="empty-email">Keine E-Mail-Adresse gefunden — weder im Inserat noch auf firmenabc.at.${emailForm}</div>${errorBanner}`;
  }

  let preview = '';
  try {
    preview = renderLetter(await composeEmail(job, profile));
  } catch {
    preview = '<p class="action-hint">Vorschau nicht verfügbar (Anschreiben fehlt).</p>';
  }

  return `<h3>E-Mail</h3>
    <div class="mail-card">
      ${emailForm}
      ${preview}
      <div class="action-row">
        <form method="post" action="/job/${job.id}/draft">
          <button type="submit" class="primary">Entwurf erstellen</button>
        </form>
        <form method="post" action="/job/${job.id}/send" onsubmit="return confirm('Wirklich an ${esc(job.email)} senden?')">
          <button type="submit" class="danger">Direkt senden</button>
        </form>
        <span class="action-hint">Entwurf = jederzeit löschbar in Gmail. Senden fragt vorher nochmal nach.</span>
      </div>
    </div>
    ${errorBanner}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>JoBBoT</title></head>'
      + '<body><div id="root"></div><script type="module" src="/app.js"></script>'
      + '<script type="module" src="/tschobbo.js"></script></body></html>');
    return;
  }

  if (req.method === 'GET' && TSCHOBBO_ASSETS.has(url.pathname)) {
    const asset = TSCHOBBO_ASSETS.get(url.pathname)!;
    try {
      const data = await readFile(asset.path);
      res.writeHead(200, { 'Content-Type': asset.type });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    const jobs = await storage.list();
    // brief lebt in data/anschreiben/{slug}.md, nicht im Job-JSON (siehe readCoverLetter
    // oben) — hier server-seitig gejoint, damit die Liste im Client die Anschreiben-
    // Vorschau zeigen kann, ohne 282 Einzel-Requests zu feuern. Der Join ist reines
    // Lesen; SPEICHERN einer Bearbeitung ist ein eigener Schreibpfad (anderer Endpunkt,
    // eigener Schritt), weil das Anschreiben nicht Teil des Job-Records ist.
    const withBriefs = await Promise.all(jobs.map(async job => ({ ...job, brief: await readCoverLetter(job) })));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(withBriefs));
    return;
  }

  // Read-only, keine eigene Speicherung — reduziert Jobs auf Kalender-Ereignisse aus
  // den bereits vorhandenen Feldern sentAt/replyReceivedAt (siehe scrapers/interface.ts).
  // Gruppierung nach Monat/Woche macht die UI (ui/app.tsx Kalender-Tab), hier nur die
  // flache Ereignisliste.
  if (req.method === 'GET' && url.pathname === '/api/calendar') {
    const jobs = await storage.list();
    const events: { date: string; type: 'sent' | 'reply'; jobId: string | null; title: string; company: string }[] = [];
    for (const job of jobs) {
      if (job.sentAt) events.push({ date: job.sentAt.slice(0, 10), type: 'sent', jobId: job.id, title: job.title, company: job.company });
      if (job.replyReceivedAt) events.push({ date: job.replyReceivedAt.slice(0, 10), type: 'reply', jobId: job.id, title: job.title, company: job.company });
    }
    // Gelabelte Bewerbungs-Mails ohne Job im Bestand (siehe lib/mail-events.ts) — jobId
    // bleibt null, die UI zeigt sie als "nur Mail" ohne Sprung in die Detailansicht.
    for (const ev of await loadMailEvents()) {
      events.push({ date: ev.date.slice(0, 10), type: 'sent', jobId: null, title: ev.title, company: ev.company });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(events));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/attachment') {
    try {
      const st = await stat(ATTACHMENT_PATH);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ filename: ATTACHMENT_FILENAME, size: st.size, uploadedAt: st.mtime.toISOString() }));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/attachment') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Datei zu groß (max. 10 MB)' }));
      return;
    }
    // Magic Bytes statt Dateiendung/Content-Type — beide sind Client-Angaben und
    // damit nicht vertrauenswürdig genug, um sie ungeprüft in einen Mail-Anhang
    // zu übernehmen.
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Keine gültige PDF-Datei' }));
      return;
    }
    await mkdir(config.attachmentsDir, { recursive: true });
    await writeFile(ATTACHMENT_PATH, buf);
    const st = await stat(ATTACHMENT_PATH);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ filename: ATTACHMENT_FILENAME, size: st.size, uploadedAt: st.mtime.toISOString() }));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/attachment') {
    await unlink(ATTACHMENT_PATH).catch(() => {});
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/cc') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ email: await loadCc() }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/cc') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let email = '';
    try {
      email = (JSON.parse(body) as { email?: string }).email?.trim() ?? '';
    } catch {
      // leer bleiben — unten als "fehlt" behandelt
    }
    if (!email) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'E-Mail-Adresse fehlt' }));
      return;
    }
    await saveCc(email);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ email }));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/cc') {
    await clearCc();
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/scrape/sources') {
    const sources = loadSources();
    const names = Object.entries(sources).filter(([, c]) => c.enabled).map(([name]) => name);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(names));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ filterMode: loadSettings().filterMode }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/scrape/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(scrapeRun));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/filter/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(filterRun));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/duplicates') {
    const jobs = await storage.list();
    const groups = findDuplicates(jobs);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(groups));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/duplicates/merge') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let keys: string[] | 'all' = [];
    try {
      const parsed = JSON.parse(body) as { keys?: string[]; all?: boolean };
      keys = parsed.all ? 'all' : (parsed.keys ?? []);
    } catch {
      // leer bleiben — behandelt wie "keine Auswahl"
    }

    const jobs = await storage.list();
    const groups = findDuplicates(jobs);
    const targets = keys === 'all' ? groups : groups.filter(g => keys.includes(g.key));

    for (const group of targets) {
      const plan = planMerge(group);
      for (const job of plan.remove) await storage.deleteJob(job);
      // Alte Datei exakt löschen statt update() (das den Dateinamen aus dem
      // gepatchten scrapedAt neu ableitet — bei gleichem Zielordner bliebe die
      // alte Datei mit dem alten Namen sonst als Leiche liegen) und dann frisch
      // unter dem übernommenen scrapedAt speichern.
      await storage.deleteJob(plan.keep);
      await storage.save({ ...plan.keep, scrapedAt: plan.scrapedAt, updatedAt: new Date().toISOString() });
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ merged: targets.length }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/anschreiben/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(anschreibenRun));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/anschreiben/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    anschreibenSse.clients.add(res);
    req.on('close', () => anschreibenSse.clients.delete(res));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/scrape/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    scrapeSse.clients.add(res);
    req.on('close', () => scrapeSse.clients.delete(res));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/filter/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    filterSse.clients.add(res);
    req.on('close', () => filterSse.clients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/scrape') {
    // Lock synchron VOR dem ersten await setzen (der Body-Read ist async) — sonst
    // könnten zwei fast gleichzeitige POSTs beide noch den alten Status sehen und
    // beide einen Lauf starten (TOCTOU). Antwort geht sofort raus; der Rest läuft
    // im Hintergrund weiter (Fire-and-Poll, siehe /api/scrape/status).
    if (scrapeRun.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ started: false, reason: 'already-running' }));
      return;
    }
    const runId = randomUUID();
    scrapeRun = { status: 'running', runId, sources: {} };
    scrapeRowCounters = {};
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ started: true, runId }));

    let body = '';
    for await (const chunk of req) body += chunk;
    let requested: string[] = [];
    try {
      requested = (JSON.parse(body) as { sources?: string[] }).sources ?? [];
    } catch {
      // leer bleiben — behandelt wie "keine Quelle ausgewählt"
    }

    const sourcesCfg = loadSources();
    const enabled = new Set(Object.entries(sourcesCfg).filter(([, c]) => c.enabled).map(([name]) => name));
    const names = requested.filter(name => enabled.has(name));

    if (names.length === 0) {
      scrapeRun = { status: 'done', runId, sources: {}, result: { newTotal: 0, skipTotal: 0, perSource: [] } };
      return;
    }

    const { registry, keep } = buildScrapeSetup();
    try {
      const outcomes = await runScrape({
        names,
        registry,
        queriesFor: name => sourcesCfg[name].queries,
        keep,
        storage,
        onProgress: (name, current, total) => {
          scrapeRun.sources[name] = { current, total };
        },
        onUnitDone: (name, items) => {
          const n = (scrapeRowCounters[name] = (scrapeRowCounters[name] ?? 0) + 1);
          scrapeSse.broadcast({
            section: name,
            sectionLabel: name,
            row: `${name}-${n}`,
            items: items.map(j => {
              const inRange = keep(j);
              return {
                id: j.url,
                tooltip: `${j.title} — ${j.company}${j.location ? ' — ' + j.location : ''}${inRange ? '' : ' — außerhalb Location-Gate'}`,
                state: inRange ? 'done' : 'excluded',
                url: j.url,
              };
            }),
          });
        },
      });
      let newTotal = 0, skipTotal = 0;
      const perSource = outcomes.map(o => {
        if (o.ok) { newTotal += o.newCount; skipTotal += o.skipCount; }
        return { name: o.name, ok: o.ok, newCount: o.newCount, skipCount: o.skipCount, error: o.ok ? undefined : String(o.error) };
      });
      scrapeRun = { status: 'done', runId, sources: scrapeRun.sources, result: { newTotal, skipTotal, perSource } };
    } catch (err) {
      scrapeRun = { status: 'error', runId, sources: scrapeRun.sources, error: err instanceof Error ? err.message : String(err) };
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/filter') {
    if (filterRun.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ started: false, reason: 'already-running' }));
      return;
    }
    const runId = randomUUID();
    filterRun = { status: 'running', runId };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ started: true, runId }));

    let body = '';
    for await (const chunk of req) body += chunk;
    let mode: FilterMode | undefined;
    let scope: 'new' | 'all' = 'new';
    try {
      const parsed = JSON.parse(body) as { mode?: FilterMode; scope?: 'new' | 'all' };
      mode = parsed.mode;
      if (parsed.scope === 'all') scope = 'all';
    } catch {
      // undefined -> filterJob fällt auf config/settings.json zurück
    }

    // Ein Batcher pro Ergebnis-Kategorie (nicht einer über den ganzen Lauf) — sonst
    // würden Match/Offstack/Brutal wild gemischt in derselben Zeile landen, statt eigene
    // Abschnitte im Grid zu bilden (siehe ui/app.tsx LoadGrid). Kategorien und Farben
    // sind dieselben wie das Fit-Urteil überall sonst in der UI (siehe ui/app.tsx FIT).
    const filterBatchers = {
      matched: createBatcher<GridSquare>(10, items => filterSse.broadcast({ section: 'matched', sectionLabel: 'Match', row: `matched-${++filterRowCounters.matched}`, items })),
      uncertain: createBatcher<GridSquare>(10, items => filterSse.broadcast({ section: 'offstack', sectionLabel: 'Offstack', row: `offstack-${++filterRowCounters.offstack}`, items })),
      filtered_out: createBatcher<GridSquare>(10, items => filterSse.broadcast({ section: 'brutal', sectionLabel: 'Brutal', row: `brutal-${++filterRowCounters.brutal}`, items })),
    };
    filterRowCounters = { matched: 0, offstack: 0, brutal: 0 };

    try {
      // scope "all" triaged jede vorhandene Job-Datei neu — siehe scripts/run-filter.ts --scope.
      const jobs = await storage.list(scope === 'all' ? undefined : { status: 'new' });
      let matched = 0, offstack = 0, brutal = 0;
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        filterRun.current = { i, total: jobs.length, title: job.title };
        const d = await filterJob(job, storage, undefined, mode);
        const ergebnis = d.status === 'matched' ? 'Match' : d.status === 'uncertain' ? 'Offstack' : 'Brutal';
        const square: GridSquare = {
          id: job.id,
          tooltip: `${job.title} — ${job.company} — ${ergebnis}`,
          state: d.status === 'matched' ? 'matched' : d.status === 'uncertain' ? 'offstack' : 'brutal',
          url: job.url,
        };
        if (d.status === 'matched') { matched++; filterBatchers.matched.push(square); }
        else if (d.status === 'uncertain') { offstack++; filterBatchers.uncertain.push(square); }
        else { brutal++; filterBatchers.filtered_out.push(square); }
      }
      filterBatchers.matched.flush();
      filterBatchers.uncertain.flush();
      filterBatchers.filtered_out.flush();
      filterRun = { status: 'done', runId, result: { matched, offstack, brutal } };
    } catch (err) {
      filterRun = { status: 'error', runId, error: err instanceof Error ? err.message : String(err) };
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/anschreiben') {
    if (anschreibenRun.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ started: false, reason: 'already-running' }));
      return;
    }
    const runId = randomUUID();
    anschreibenRun = { status: 'running', runId };
    anschreibenAbort = new AbortController();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ started: true, runId }));

    let body = '';
    for await (const chunk of req) body += chunk;
    let jobIds: string[] = [];
    try {
      jobIds = (JSON.parse(body) as { jobIds?: string[] }).jobIds ?? [];
    } catch {
      // leer bleiben — behandelt wie "keine Auswahl"
    }

    try {
      // Nur triaged+nicht-brutal ist gültig (generateAnschreiben() prüft das selbst
      // nochmal) — hier vorab gefiltert, damit "skipped" korrekt zählt, statt
      // still Lücken aus fehlenden/ungeeigneten IDs zu übernehmen.
      const fetched = await Promise.all(jobIds.map(id => storage.get(id)));
      const jobs = fetched.filter((j): j is Job => j !== null && canGenerateAnschreiben(j));
      const preSkipped = jobIds.length - jobs.length;

      if (jobs.length === 0) {
        anschreibenRun = { status: 'done', runId, result: { generated: 0, skipped: preSkipped, emailsFound: 0, mailGenerated: 0, nomailGenerated: 0 } };
        return;
      }

      const { generated, skipped, emailsFound, mailGenerated, nomailGenerated } = await runAnschreiben({
        jobs,
        storage,
        profile,
        signal: anschreibenAbort.signal,
        onProgress: (i, total, title) => {
          anschreibenRun.current = { i, total, title };
        },
        onItemDone: item => anschreibenSse.broadcast({ section: runId, sectionLabel: 'Anschreiben', row: item.id, items: [item] }),
      });
      anschreibenRun = {
        status: anschreibenAbort.signal.aborted ? 'stopped' : 'done',
        runId,
        result: { generated, skipped: skipped + preSkipped, emailsFound, mailGenerated, nomailGenerated },
      };
    } catch (err) {
      anschreibenRun = { status: 'error', runId, error: err instanceof Error ? err.message : String(err) };
    } finally {
      anschreibenAbort = null;
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/anschreiben/stop') {
    if (anschreibenRun.status !== 'running' || !anschreibenAbort) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ stopped: false, reason: 'not-running' }));
      return;
    }
    anschreibenAbort.abort();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ stopped: true }));
    return;
  }

  // Rückwirkender Sync: liest Gesendet-Ordner und INBOX und trägt nach, was in den
  // Job-JSONs fehlt. Manuell ausgelöst wie die anderen Mail-Features (kein Daemon).
  //
  // Drei Zusagen, die hier bewusst im Code stehen und nicht nur im Auftrag:
  //  1. read-only gegenüber Gmail — beide Ordner werden mit readOnly:true geöffnet,
  //     nichts wird gesendet, gelöscht, verschoben oder als gelesen markiert;
  //  2. füllt nur Lücken — ein vorhandenes sentAt/replyReceivedAt bleibt unangetastet,
  //     damit ein heuristischer Treffer nie einen echten Wert überschreibt;
  //  3. ändert keinen Status — geschrieben werden ausschließlich die zwei Datumsfelder.
  if (req.method === 'POST' && url.pathname === '/api/gmail-sync') {
    try {
      const jobs = await storage.list();
      const kandidaten = jobs.filter(j => j.email && !j.sentAt);
      // Fester Startpunkt statt aus scrapedAt abgeleitet: gescannt wird der Zeitraum,
      // den auch der Kalender anzeigt (siehe lib/calendar.ts HISTORY_START).
      const since = new Date(HISTORY_START);

      // Der Scan läuft auch ohne Kandidaten. Er schreibt dann nichts, aber die Zahl der
      // gelesenen Mails macht sichtbar, ob das Postfach überhaupt etwas hergibt — ein
      // stilles "0 ergänzt" verrät nicht, ob nichts da war oder nichts zugeordnet wurde.
      const alleSent = await fetchSentMails(since);
      // Nur was du in Gmail als Bewerbung markiert hast — sonst landete jede private
      // Mail im Kalender.
      const sentMails = alleSent.filter(istBewerbung);
      let sentGefuellt = 0;
      const zugeordnet = new Set<SentMail>();
      for (const { job, date, mail } of matchSent(sentMails, jobs)) {
        await storage.update(job.id, { sentAt: date.toISOString() });
        zugeordnet.add(mail);
        sentGefuellt++;
      }

      // Gelabelte Mails ohne Job: als eigene Kalender-Ereignisse ablegen, damit der
      // Zeitraum vollständig sichtbar ist statt an Lücken im Job-Bestand zu scheitern.
      const ohneJob = sentMails.filter(m => !zugeordnet.has(m));
      await saveMailEvents(toMailEvents(ohneJob));

      // Frisch aus dem Sent-Scan gesetzte sentAt sollen sofort für die Antwort-Zuordnung
      // zählen, deshalb die Liste neu laden statt die veraltete weiterzureichen.
      const nachSent = await storage.list();
      const replies = await fetchInboxReplies(since);
      let replyGefuellt = 0;
      for (const { job, reply } of matchReplies(replies, nachSent)) {
        if (job.replyReceivedAt) continue; // Lücken füllen, nicht überschreiben
        await storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
        replyGefuellt++;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        sentGescannt: alleSent.length,
        markiert: sentMails.length,
        sentGefuellt,
        ohneJob: ohneJob.length,
        replyGescannt: replies.length,
        replyGefuellt,
        seit: HISTORY_START,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  // Manuell auslösbarer Fetch statt Auto-Polling-Daemon (siehe Auftrag: Prototyp reicht
  // ein Button/eine Route, systemd-Scheduling wäre ein separater Auftrag).
  if (req.method === 'POST' && url.pathname === '/api/mail/replies/fetch') {
    try {
      const jobs = await storage.list();
      const gesendetDates = jobs.filter(j => j.status === 'gesendet' && j.email).map(j => new Date(j.updatedAt).getTime());
      if (gesendetDates.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ checked: 0, matched: 0 }));
        return;
      }
      const since = new Date(Math.min(...gesendetDates));
      const replies = await fetchInboxReplies(since);
      const matches = matchReplies(replies, jobs);
      for (const { job, reply } of matches) {
        await storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ checked: replies.length, matched: matches.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }

  const jobPatchMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)$/);
  if (req.method === 'POST' && jobPatchMatch) {
    const job = await storage.get(jobPatchMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    // Nur status/fit sind hier gemeint (Aktionen entlang der Statusmaschine im UI) —
    // keine serverseitige Allowlist, weil dieser Server nur lokal auf localhost läuft
    // und der Client (ui/app.tsx) ohnehin nie andere Felder schickt.
    const patch = JSON.parse(body) as Partial<Pick<Job, 'status' | 'fit'>>;
    const updated = await storage.update(job.id, patch);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(updated));
    return;
  }

  const apiDraftMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/draft$/);
  if (req.method === 'POST' && apiDraftMatch) {
    const job = await storage.get(apiDraftMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const email = await composeEmail(job, profile);
      await createDraft(email);
      const updated = await storage.updateStatus(job.id, 'postausgang');
      await logMailAction(job, 'drafted');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Entwurf fehlgeschlagen: ${message}` }));
    }
    return;
  }

  const apiSendMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/send$/);
  if (req.method === 'POST' && apiSendMatch) {
    const job = await storage.get(apiSendMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const email = await composeEmail(job, profile);
      await sendMail(email);
      const updated = await storage.update(job.id, { status: 'gesendet', sentAt: new Date().toISOString() });
      await logMailAction(job, 'sent');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Versand fehlgeschlagen: ${message}` }));
    }
    return;
  }

  const briefMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/brief$/);
  if (req.method === 'POST' && briefMatch) {
    const job = await storage.get(briefMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const { text } = JSON.parse(body) as { text: string };
    // Gegenstück zum Join in GET /api/jobs: brief lebt in data/anschreiben/{slug}.md,
    // nicht im Job-JSON, also schreibt eine Bearbeitung dorthin statt über
    // storage.update() — ein Status-Wechsel und eine Anschreiben-Bearbeitung sind zwei
    // unabhängige Schreibpfade, die zufällig denselben Job betreffen.
    await writeFile(join(config.anschreibenDir, `${jobBasename(job)}.md`), text, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app.js') {
    try {
      const js = await readFile(join(import.meta.dirname, '..', 'ui', 'dist', 'app.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(js);
    } catch {
      res.writeHead(404).end('app.js nicht gebaut — npm run build:ui');
    }
    return;
  }

  const jobMatch = url.pathname.match(/^\/job\/([a-f0-9]+)$/);
  if (req.method === 'GET' && jobMatch) {
    const job = await storage.get(jobMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    const cover = await readCoverLetter(job);
    const options = STATUSES.map(s => `<option value="${s}" ${s === job.status ? 'selected' : ''}>${s}</option>`).join('');
    const error = url.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(layout(`
      <p><a href="/">&larr; zurück</a></p>
      <h1>${esc(job.title)}</h1>
      <p><strong>${esc(job.company)}</strong> — ${esc(job.location ?? '')} — <a href="${esc(job.url)}" target="_blank">Anzeige</a></p>
      <form method="post" action="/job/${job.id}/status">
        <select name="status">${options}</select>
        <button type="submit">Status ändern</button>
      </form>
      ${cover ? `<h3>Anschreiben</h3><pre>${esc(cover)}</pre>` : ''}
      ${await renderMailSection(job, error)}
      <h3>Beschreibung</h3>
      <pre>${esc(job.description)}</pre>
    `));
    return;
  }

  const statusMatch = url.pathname.match(/^\/job\/([a-f0-9]+)\/status$/);
  if (req.method === 'POST' && statusMatch) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const status = new URLSearchParams(body).get('status') as JobStatus | null;
    if (status && STATUSES.includes(status)) await storage.updateStatus(statusMatch[1], status);
    res.writeHead(302, { Location: `/job/${statusMatch[1]}` });
    res.end();
    return;
  }

  const emailMatch = url.pathname.match(/^\/job\/([a-f0-9]+)\/email$/);
  if (req.method === 'POST' && emailMatch) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const email = new URLSearchParams(body).get('email');
    if (email) await storage.update(emailMatch[1], { email });
    res.writeHead(302, { Location: `/job/${emailMatch[1]}` });
    res.end();
    return;
  }

  const draftMatch = url.pathname.match(/^\/job\/([a-f0-9]+)\/draft$/);
  if (req.method === 'POST' && draftMatch) {
    const job = await storage.get(draftMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const email = await composeEmail(job, profile);
      await createDraft(email);
      await storage.updateStatus(job.id, 'postausgang');
      await logMailAction(job, 'drafted');
      res.writeHead(302, { Location: `/job/${job.id}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(302, { Location: `/job/${job.id}?error=${encodeURIComponent(`Entwurf fehlgeschlagen: ${message}`)}` });
    }
    res.end();
    return;
  }

  const sendMatch = url.pathname.match(/^\/job\/([a-f0-9]+)\/send$/);
  if (req.method === 'POST' && sendMatch) {
    const job = await storage.get(sendMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const email = await composeEmail(job, profile);
      await sendMail(email);
      await storage.update(job.id, { status: 'gesendet', sentAt: new Date().toISOString() });
      await logMailAction(job, 'sent');
      res.writeHead(302, { Location: `/job/${job.id}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(302, { Location: `/job/${job.id}?error=${encodeURIComponent(`Versand fehlgeschlagen: ${message}`)}` });
    }
    res.end();
    return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => console.log(`JobBot UI: http://localhost:${PORT}`));
