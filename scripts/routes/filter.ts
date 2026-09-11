import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadSettings, type FilterMode } from '../../lib/settings.ts';
import { runFilter } from '../../lib/filter-runner.ts';
import { createBatcher } from '../../lib/grid-batch.ts';
import { createSseChannel, type GridSquare, type GridUnitEvent } from './sse-channel.ts';
import type { Ctx } from './context.ts';

interface FilterRunState {
  status: 'idle' | 'running' | 'done' | 'error';
  runId: string | null;
  current?: { i: number; total: number; title: string };
  result?: { matched: number; offstack: number; brutal: number };
  error?: string;
}
let filterRun: FilterRunState = { status: 'idle', runId: null };
const filterSse = createSseChannel<GridUnitEvent>();
let filterRowCounters = { matched: 0, offstack: 0, brutal: 0 };

export async function handleFilterRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/settings') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ filterMode: loadSettings().filterMode }));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/filter/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(filterRun));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/filter/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    filterSse.clients.add(res);
    req.on('close', () => filterSse.clients.delete(res));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/filter') {
    if (filterRun.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ started: false, reason: 'already-running' }));
      return true;
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
        storage: ctx.storage,
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
    return true;
  }

  return false;
}
