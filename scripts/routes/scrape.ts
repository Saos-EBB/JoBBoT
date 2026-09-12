import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadSources } from '../../lib/sources.ts';
import { adapterRegistry, buildScrapeSetup } from '../../lib/scrape-setup.ts';
import { runScrape } from '../../lib/scrape-runner.ts';
import { createSseChannel, attachSseClient, type GridUnitEvent } from './sse-channel.ts';
import { respondJson, readJsonBody } from './http.ts';
import { createRunState } from './run-state.ts';
import { beginRun, finishRun, parseBodyOrDefault } from './runnable-route.ts';
import type { RunSnapshot } from './run-state.ts';
import type { Ctx } from './context.ts';

// ---------- Scrape-Run-State (in-memory, Prozesslebensdauer) ----------
// Kein Persistieren auf Disk: Einzelnutzer-Lokaltool, ein Server-Neustart mitten
// im Lauf verliert den Fortschritt (akzeptiert) — der Client erkennt das daran,
// dass der Status auf 'idle' statt 'done'/'error' zurückfällt (siehe Client-Poll).
export type ScrapeResult = { newTotal: number; skipTotal: number; offlineTotal: number; backTotal: number; perSource: { name: string; ok: boolean; newCount: number; skipCount: number; offlineCount: number; backCount: number; error?: string }[] };
// GET /api/scrape/status — exportiert, damit ui/hooks/run-status-poll.ts diese Form
// importiert statt sie von Hand nachzubauen (import type wird von esbuild vollständig
// entfernt, zieht also keine node:fs-Importe dieser Datei ins Browser-Bundle).
export type ScrapeStatusResponse = RunSnapshot<ScrapeResult> & { sources: Record<string, { current: number; total: number }> };
const scrapeRun = createRunState<ScrapeResult>();
// Fortschritt pro Quelle — eigene Variable statt Teil von RunSnapshot, weil ihre Form
// (eine Map, kein einzelnes {i,total}) pro Route unterschiedlich ist (siehe run-state.ts).
let scrapeSources: Record<string, { current: number; total: number }> = {};
const scrapeSse = createSseChannel<GridUnitEvent>();
// Zeilen-Zähler pro Quelle, nur für eindeutige Grid-Row-Keys — bei jedem neuen
// Scrape-Lauf zurückgesetzt (siehe POST /api/scrape).
let scrapeRowCounters: Record<string, number> = {};

// Von routes/config.ts gelesen: ein laufender Scrape soll sich melden können, ohne
// dass die Config-Route den kompletten Scrape-Run-State kennen muss.
export function isScrapeRunning(): boolean {
  return scrapeRun.isRunning();
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
    const response: ScrapeStatusResponse = { ...scrapeRun.get(), sources: scrapeSources };
    respondJson(res, 200, response);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/scrape/stream') {
    attachSseClient(req, res, scrapeSse);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/scrape') {
    const runId = beginRun(res, scrapeRun, () => { scrapeSources = {}; scrapeRowCounters = {}; });
    if (!runId) return true;

    const body = await parseBodyOrDefault(() => readJsonBody<{ sources?: string[] }>(req), {});
    const requested = body.sources ?? [];

    const sourcesCfg = loadSources();
    const enabled = new Set(Object.entries(sourcesCfg).filter(([, c]) => c.enabled).map(([name]) => name));
    const names = requested.filter(name => enabled.has(name));

    await finishRun(scrapeRun, async () => {
      if (names.length === 0) {
        return { result: { newTotal: 0, skipTotal: 0, offlineTotal: 0, backTotal: 0, perSource: [] } };
      }

      const { registry, keep } = buildScrapeSetup();
      const outcomes = await runScrape({
        names,
        registry,
        queriesFor: name => sourcesCfg[name].queries,
        keep,
        storage: ctx.storage,
        onProgress: (name, current, total) => {
          scrapeSources[name] = { current, total };
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
      return { result: { newTotal, skipTotal, offlineTotal, backTotal, perSource } };
    });
    return true;
  }

  return false;
}
