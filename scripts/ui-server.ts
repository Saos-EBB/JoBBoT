import { createServer, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, stat, unlink, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createStorage } from '../storage/index.ts';
import { config } from '../config.ts';
import { findAnschreiben, anschreibenZiel, anschreibenName } from '../lib/anschreiben-datei.ts';
import { loadProfile } from '../lib/profile.ts';
import { fetchInboxReplies, fetchSentMails, istBewerbung, type SentMail } from '../mail/gmail.ts';
import { versende } from '../lib/versand.ts';
import { matchReplies, matchSent } from '../lib/mail-match.ts';
import { HISTORY_START } from '../lib/calendar.ts';
import { loadMailEvents, saveMailEvents, toMailEvents } from '../lib/mail-events.ts';
import { ATTACHMENT_PATH, ATTACHMENT_FILENAME } from '../lib/attachment.ts';
import { loadCc, saveCc, clearCc } from '../lib/cc.ts';
import { loadSources } from '../lib/sources.ts';
import { loadSettings, type FilterMode } from '../lib/settings.ts';
import { adapterRegistry, buildScrapeSetup } from '../lib/scrape-setup.ts';
import { isConfigName, readConfig, writeConfig, restoreConfig, hasBackup, validateConfig } from '../lib/config-store.ts';
import { runScrape } from '../lib/scrape-runner.ts';
import { runFilter } from '../lib/filter-runner.ts';
import { createBatcher } from '../lib/grid-batch.ts';
import { findDuplicates, planMerge } from '../lib/duplicates.ts';
import { canGenerateAnschreiben } from '../lib/folders.ts';
import { runAnschreiben } from '../lib/anschreiben-runner.ts';
import type { Job } from '../scrapers/interface.ts';

function portFromArgs(): string | undefined {
  const flag = process.argv.find(a => a === '--port' || a.startsWith('--port='));
  if (!flag) return undefined;
  if (flag.includes('=')) return flag.split('=')[1];
  return process.argv[process.argv.indexOf(flag) + 1];
}

const PORT = Number(portFromArgs() ?? process.env.UI_PORT ?? 3000);
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
  result?: { newTotal: number; skipTotal: number; offlineTotal: number; backTotal: number; perSource: { name: string; ok: boolean; newCount: number; skipCount: number; offlineCount: number; backCount: number; error?: string }[] };
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

async function readCoverLetter(job: { id: string }): Promise<string | null> {
  const path = await findAnschreiben(job);
  if (!path) return null;
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
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
    const events: { date: string; type: 'sent' | 'reply' | 'followup'; jobId: string | null; title: string; company: string }[] = [];
    for (const job of jobs) {
      if (job.sentAt) events.push({ date: job.sentAt.slice(0, 10), type: 'sent', jobId: job.id, title: job.title, company: job.company });
      // Jeder Nachfass ein eigener Eintrag, nicht nur der letzte: der Kalender soll
      // zeigen, WIE OFT und WANN nachgehakt wurde, nicht bloß dass es passiert ist.
      for (const fu of job.followUps ?? []) {
        events.push({ date: fu.at.slice(0, 10), type: 'followup', jobId: job.id, title: job.title, company: job.company });
      }
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

  // Das querySchema jedes Portals, damit die Einstellungsseite ihr Formular daraus bauen
  // kann. Kommt aus der Registry, nicht aus config/sources.json — der Code sagt, welche
  // Portale es gibt und welche Felder sie kennen (siehe Ticket "Schema pro Portal").
  if (req.method === 'GET' && url.pathname === '/api/config/schema') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(
      Object.fromEntries(Object.entries(adapterRegistry).map(([name, a]) => [name, a.querySchema])),
    ));
    return;
  }

  // Config-Endpunkte fuer die Einstellungsseite. Ein GET/PUT je Datei statt eines
  // Sammel-Endpunkts: die beiden Dateien haben getrennte Bedeutung, und ein PUT, das
  // beide schreibt, schriebe auch, was niemand angefasst hat.
  const configMatch = url.pathname.match(/^\/api\/config\/([a-z]+)$/);
  if (configMatch && (req.method === 'GET' || req.method === 'PUT')) {
    const name = configMatch[1];
    if (!isConfigName(name)) { res.writeHead(404).end('Unbekannte Konfiguration'); return; }

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ data: await readConfig(name), hasBackup: await hasBackup(name) }));
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ errors: [`Kein gültiges JSON: ${err instanceof Error ? err.message : String(err)}`] }));
      return;
    }
    const errors = validateConfig(name, data);
    if (errors.length > 0) {
      res.writeHead(422, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ errors }));
      return;
    }
    await writeConfig(name, data);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    // scrapeRun.status mitschicken: loadSources() liest pro Nutzung frisch, ein
    // laufender Scrape sieht die Aenderung also mitten drin. Gesperrt wird nicht (der
    // Schaden ist eine Anfrage mehr oder weniger), aber die Seite soll es sagen koennen.
    res.end(JSON.stringify({ ok: true, scrapeRunning: scrapeRun.status === 'running' }));
    return;
  }

  const restoreMatch = url.pathname.match(/^\/api\/config\/([a-z]+)\/restore$/);
  if (req.method === 'POST' && restoreMatch) {
    const name = restoreMatch[1];
    if (!isConfigName(name)) { res.writeHead(404).end('Unbekannte Konfiguration'); return; }
    const restored = await restoreConfig(name);
    res.writeHead(restored ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(restored ? { ok: true, data: await readConfig(name) } : { error: 'Keine gesicherte Fassung vorhanden' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/scrape/sources') {
    // Ausgangspunkt ist die Registry, nicht die Datei. Vorher lief das andersherum als
    // in run-scrape.ts — ein Portalname in sources.json ohne Adapter erschien hier als
    // auswählbare Quelle und lief dann in lib/scrape-runner.ts auf registry[name].kind
    // eines undefined. Jetzt sind beide Wege gleich: Code sagt, was es gibt.
    const sources = loadSources();
    const names = Object.keys(adapterRegistry).filter(name => sources[name]?.enabled);
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
      // Das Anschreiben lebt nicht im Job-JSON, wird hier also nicht automatisch
      // mit-verschmolzen. Hat der behaltene Job noch keins, einer der entfernten
      // Zwillinge aber schon, wandert dessen Brief mit — sonst löscht der Merge die
      // Job-Datei und lässt einen Brief zurück, den kein Job mehr findet.
      // Der jüngste Zwilling mit Brief gewinnt (plan.remove ist nach scrapedAt
      // aufsteigend sortiert, siehe findDuplicates).
      if (!await findAnschreiben(plan.keep)) {
        for (const alt of [...plan.remove].reverse()) {
          const brief = await findAnschreiben(alt);
          if (!brief) continue;
          await rename(brief, join(config.anschreibenDir, `${anschreibenName(plan.keep)}.md`));
          break;
        }
      }
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
      scrapeRun = { status: 'done', runId, sources: {}, result: { newTotal: 0, skipTotal: 0, offlineTotal: 0, backTotal: 0, perSource: [] } };
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
      let newTotal = 0, skipTotal = 0, offlineTotal = 0, backTotal = 0;
      const perSource = outcomes.map(o => {
        if (o.ok) { newTotal += o.newCount; skipTotal += o.skipCount; offlineTotal += o.offlineCount; backTotal += o.backCount; }
        return { name: o.name, ok: o.ok, newCount: o.newCount, skipCount: o.skipCount, offlineCount: o.offlineCount, backCount: o.backCount, error: o.ok ? undefined : String(o.error) };
      });
      scrapeRun = { status: 'done', runId, sources: scrapeRun.sources, result: { newTotal, skipTotal, offlineTotal, backTotal, perSource } };
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

    filterRowCounters = { matched: 0, offstack: 0, brutal: 0 };
    // Ein Batcher pro Ergebnis-Kategorie (nicht einer über den ganzen Lauf) — sonst
    // würden Match/Offstack/Brutal wild gemischt in derselben Zeile landen, statt eigene
    // Abschnitte im Grid zu bilden (siehe ui/app.tsx LoadGrid). Kategorien und Farben
    // sind dieselben wie das Fit-Urteil überall sonst in der UI (siehe ui/app.tsx FIT).
    const filterBatchers = {
      matched: createBatcher<GridSquare>(10, items => filterSse.broadcast({ section: 'matched', sectionLabel: 'Match', row: `matched-${++filterRowCounters.matched}`, items })),
      uncertain: createBatcher<GridSquare>(10, items => filterSse.broadcast({ section: 'offstack', sectionLabel: 'Offstack', row: `offstack-${++filterRowCounters.offstack}`, items })),
      filtered_out: createBatcher<GridSquare>(10, items => filterSse.broadcast({ section: 'brutal', sectionLabel: 'Brutal', row: `brutal-${++filterRowCounters.brutal}`, items })),
    };

    try {
      // Dieselbe Schleife wie das CLI (lib/filter-runner.ts) — der Runner schreibt dabei
      // auch data/filter-log.md, was dieser Pfad vorher als einziger nicht tat.
      const { matched, offstack, brutal } = await runFilter({
        storage,
        scope,
        mode,
        onProgress: (i, total, job) => {
          filterRun.current = { i, total, title: job.title };
        },
        onDecision: d => {
          const ergebnis = d.status === 'matched' ? 'Match' : d.status === 'uncertain' ? 'Offstack' : 'Brutal';
          const square: GridSquare = {
            id: d.job.id,
            tooltip: `${d.job.title} — ${d.job.company} — ${ergebnis}`,
            state: d.status === 'matched' ? 'matched' : d.status === 'uncertain' ? 'offstack' : 'brutal',
            url: d.job.url,
          };
          if (d.status === 'matched') filterBatchers.matched.push(square);
          else if (d.status === 'uncertain') filterBatchers.uncertain.push(square);
          else filterBatchers.filtered_out.push(square);
        },
      });
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
    // status/fit (Aktionen entlang der Statusmaschine) und email (von Hand korrigierte
    // Empfängeradresse, siehe ui/app.tsx saveEmail) — keine serverseitige Allowlist,
    // weil dieser Server nur lokal auf localhost läuft und der Client ohnehin nie
    // andere Felder schickt.
    const patch = JSON.parse(body) as Partial<Pick<Job, 'status' | 'fit' | 'email'>>;
    const updated = await storage.update(job.id, patch);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(updated));
    return;
  }

  // Nachfass: eine Route für beide Wege, weil sich nur der letzte Schritt unterscheidet
  // (Entwurf anlegen vs. senden) — Betreff, Text und die Historie sind identisch.
  // Anders als /send ändert das den Status NICHT: die Bewerbung war schon gesendet und
  // bleibt es, ein Nachfass ist kein neuer Zustand, sondern ein weiterer Kontakt.
  const followUpMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/followup$/);
  if (req.method === 'POST' && followUpMatch) {
    const job = await storage.get(followUpMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    let via: 'draft' | 'sent' = 'draft';
    try {
      via = (JSON.parse(body) as { via?: 'draft' | 'sent' }).via === 'sent' ? 'sent' : 'draft';
    } catch {
      // kein Body — bleibt beim sichereren Entwurf
    }
    try {
      const updated = await versende({ job, art: 'nachfass', weg: via === 'sent' ? 'senden' : 'entwurf', storage, profile });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Nachfass fehlgeschlagen: ${message}` }));
    }
    return;
  }

  const apiDraftMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/draft$/);
  if (req.method === 'POST' && apiDraftMatch) {
    const job = await storage.get(apiDraftMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const updated = await versende({ job, art: 'bewerbung', weg: 'entwurf', storage, profile });
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
      const updated = await versende({ job, art: 'bewerbung', weg: 'senden', storage, profile });
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
    await writeFile(await anschreibenZiel(job), text, 'utf8');
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

  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => console.log(`JobBot UI: http://localhost:${PORT}`));
