import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadSources } from '../../lib/sources.ts';
import { adapterRegistry, buildScrapeSetup } from '../../lib/scrape-setup.ts';
import { runScrape } from '../../lib/scrape-runner.ts';
import { createSseChannel, attachSseClient, type GridUnitEvent } from './sse-channel.ts';
import { respondJson, readJsonBody } from './http.ts';
import type { Ctx } from './context.ts';

// ---------- Scrape-Run-State (in-memory, Prozesslebensdauer) ----------
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
let scrapeRun: ScrapeRunState = { status: 'idle', runId: null, sources: {} };
const scrapeSse = createSseChannel<GridUnitEvent>();
// Zeilen-Zähler pro Quelle, nur für eindeutige Grid-Row-Keys — bei jedem neuen
// Scrape-Lauf zurückgesetzt (siehe POST /api/scrape).
let scrapeRowCounters: Record<string, number> = {};

// Von routes/config.ts gelesen: ein laufender Scrape soll sich melden können, ohne
// dass die Config-Route den kompletten Scrape-Run-State kennen muss.
export function isScrapeRunning(): boolean {
  return scrapeRun.status === 'running';
}

export async function handleScrapeRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/scrape/sources') {
    // Ausgangspunkt ist die Registry, nicht die Datei. Vorher lief das andersherum als
    // in run-scrape.ts — ein Portalname in sources.json ohne Adapter erschien hier als
    // auswählbare Quelle und lief dann in lib/scrape-runner.ts auf registry[name].kind
    // eines undefined. Jetzt sind beide Wege gleich: Code sagt, was es gibt.
    const sources = loadSources();
    const names = Object.keys(adapterRegistry).filter(name => sources[name]?.enabled);
    respondJson(res, 200, names);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/scrape/status') {
    respondJson(res, 200, scrapeRun);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/scrape/stream') {
    attachSseClient(req, res, scrapeSse);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/scrape') {
    // Lock synchron VOR dem ersten await setzen (der Body-Read ist async) — sonst
    // könnten zwei fast gleichzeitige POSTs beide noch den alten Status sehen und
    // beide einen Lauf starten (TOCTOU). Antwort geht sofort raus; der Rest läuft
    // im Hintergrund weiter (Fire-and-Poll, siehe /api/scrape/status).
    if (scrapeRun.status === 'running') {
      respondJson(res, 409, { started: false, reason: 'already-running' });
      return true;
    }
    const runId = randomUUID();
    scrapeRun = { status: 'running', runId, sources: {} };
    scrapeRowCounters = {};
    respondJson(res, 200, { started: true, runId });

    let requested: string[] = [];
    try {
      requested = (await readJsonBody<{ sources?: string[] }>(req)).sources ?? [];
    } catch {
      // leer bleiben — behandelt wie "keine Quelle ausgewählt"
    }

    const sourcesCfg = loadSources();
    const enabled = new Set(Object.entries(sourcesCfg).filter(([, c]) => c.enabled).map(([name]) => name));
    const names = requested.filter(name => enabled.has(name));

    if (names.length === 0) {
      scrapeRun = { status: 'done', runId, sources: {}, result: { newTotal: 0, skipTotal: 0, offlineTotal: 0, backTotal: 0, perSource: [] } };
      return true;
    }

    const { registry, keep } = buildScrapeSetup();
    try {
      const outcomes = await runScrape({
        names,
        registry,
        queriesFor: name => sourcesCfg[name].queries,
        keep,
        storage: ctx.storage,
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
                state: inRange ? 'done' as const : 'excluded' as const,
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
    return true;
  }

  return false;
}
