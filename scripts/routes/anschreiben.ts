import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { canGenerateAnschreiben } from '../../lib/folders.ts';
import { runAnschreiben } from '../../lib/anschreiben-runner.ts';
import { createSseChannel, type GridUnitEvent } from './sse-channel.ts';
import type { Ctx } from './context.ts';
import type { Job } from '../../scrapers/interface.ts';

interface AnschreibenRunState {
  status: 'idle' | 'running' | 'done' | 'error' | 'stopped';
  runId: string | null;
  current?: { i: number; total: number; title: string };
  result?: { generated: number; skipped: number; emailsFound: number; mailGenerated: number; nomailGenerated: number };
  error?: string;
}
let anschreibenRun: AnschreibenRunState = { status: 'idle', runId: null };
// Nur für Anschreiben abbrechbar (Scrape/Filter sind schnell genug, dass ein Stop-Button
// bisher niemand vermisst hat) — ein einzelner Lauf gleichzeitig, wie anschreibenRun selbst.
let anschreibenAbort: AbortController | null = null;
const anschreibenSse = createSseChannel<GridUnitEvent>();

export async function handleAnschreibenRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/anschreiben/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(anschreibenRun));
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/anschreiben/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    anschreibenSse.clients.add(res);
    req.on('close', () => anschreibenSse.clients.delete(res));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/anschreiben') {
    if (anschreibenRun.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ started: false, reason: 'already-running' }));
      return true;
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
      const fetched = await Promise.all(jobIds.map(id => ctx.storage.get(id)));
      const jobs = fetched.filter((j): j is Job => j !== null && canGenerateAnschreiben(j));
      const preSkipped = jobIds.length - jobs.length;

      if (jobs.length === 0) {
        anschreibenRun = { status: 'done', runId, result: { generated: 0, skipped: preSkipped, emailsFound: 0, mailGenerated: 0, nomailGenerated: 0 } };
        return true;
      }

      const { generated, skipped, emailsFound, mailGenerated, nomailGenerated } = await runAnschreiben({
        jobs,
        storage: ctx.storage,
        profile: ctx.profile,
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
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/anschreiben/stop') {
    if (anschreibenRun.status !== 'running' || !anschreibenAbort) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ stopped: false, reason: 'not-running' }));
      return true;
    }
    anschreibenAbort.abort();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ stopped: true }));
    return true;
  }

  return false;
}
