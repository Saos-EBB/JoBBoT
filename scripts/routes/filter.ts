import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadSettings, type FilterMode } from '../../lib/settings.ts';
import { runFilter } from '../../lib/filter-runner.ts';
import { createBatcher } from '../../lib/grid-batch.ts';
import { desktopNotify } from '../../lib/desktop-notify.ts';
import { createSseChannel, attachSseClient, type GridSquare, type GridUnitEvent } from './sse-channel.ts';
import { respondJson, readJsonBody } from './http.ts';
import { createRunState } from './run-state.ts';
import { beginRun, finishRun, parseBodyOrDefault } from './runnable-route.ts';
import type { RunSnapshot } from './run-state.ts';
import type { Ctx } from './context.ts';

export type FilterResult = { matched: number; offstack: number; brutal: number };
export type FilterStatusResponse = RunSnapshot<FilterResult> & { current?: { i: number; total: number; title: string } };
export type SettingsResponse = { filterMode: FilterMode };
const filterRun = createRunState<FilterResult>();
let filterCurrent: { i: number; total: number; title: string } | undefined;
const filterSse = createSseChannel<GridUnitEvent>();
let filterRowCounters = { matched: 0, offstack: 0, brutal: 0 };

export async function handleFilterRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const response: SettingsResponse = { filterMode: loadSettings().filterMode };
    respondJson(res, 200, response);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/filter/status') {
    const response: FilterStatusResponse = { ...filterRun.get(), current: filterCurrent };
    respondJson(res, 200, response);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/filter/stream') {
    attachSseClient(req, res, filterSse);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/filter') {
    const runId = beginRun(res, filterRun, () => { filterCurrent = undefined; });
    if (!runId) return true;

    const parsed = await parseBodyOrDefault(() => readJsonBody<{ mode?: FilterMode; scope?: 'new' | 'all' }>(req), {});
    const mode = parsed.mode; // undefined -> filterJob fällt auf config/settings.json zurück
    const scope: 'new' | 'all' = parsed.scope === 'all' ? 'all' : 'new';

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

    await finishRun(filterRun, async () => {
      // Dieselbe Schleife wie das CLI (lib/filter-runner.ts) — der Runner schreibt dabei
      // auch data/filter-log.md, was dieser Pfad vorher als einziger nicht tat.
      const { matched, offstack, brutal } = await runFilter({
        storage: ctx.storage,
        scope,
        mode,
        onProgress: (i, total, job) => {
          filterCurrent = { i, total, title: job.title };
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
      return { result: { matched, offstack, brutal } };
    });
    const snap = filterRun.get();
    desktopNotify('JoBBoT — Filter fertig', snap.status === 'error'
      ? `Fehlgeschlagen: ${snap.error ?? ''}`
      : `${snap.result?.matched ?? 0} Match, ${snap.result?.offstack ?? 0} Offstack, ${snap.result?.brutal ?? 0} Brutal`);
    return true;
  }

  return false;
}
