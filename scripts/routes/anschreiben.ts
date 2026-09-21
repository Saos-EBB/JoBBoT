import type { IncomingMessage, ServerResponse } from 'node:http';
import { canGenerateAnschreiben } from '../../lib/folders.ts';
import { runAnschreiben } from '../../lib/anschreiben-runner.ts';
import { ensureOllama } from '../../lib/ollama.ts';
import { desktopNotify } from '../../lib/desktop-notify.ts';
import { createSseChannel, attachSseClient, type GridUnitEvent } from './sse-channel.ts';
import { respondJson, readJsonBody } from './http.ts';
import { createRunState } from './run-state.ts';
import { beginRun, finishRun, parseBodyOrDefault } from './runnable-route.ts';
import type { RunSnapshot } from './run-state.ts';
import type { Ctx } from './context.ts';
import type { Job } from '../../scrapers/interface.ts';

export type AnschreibenResult = { generated: number; skipped: number; emailsFound: number; mailGenerated: number; nomailGenerated: number };
export type AnschreibenStatusResponse = RunSnapshot<AnschreibenResult> & { current?: { i: number; total: number; title: string } };
const anschreibenRun = createRunState<AnschreibenResult>();
let anschreibenCurrent: { i: number; total: number; title: string } | undefined;
// Nur für Anschreiben abbrechbar (Scrape/Filter sind schnell genug, dass ein Stop-Button
// bisher niemand vermisst hat) — ein einzelner Lauf gleichzeitig, wie anschreibenRun selbst.
let anschreibenAbort: AbortController | null = null;
const anschreibenSse = createSseChannel<GridUnitEvent>();

export async function handleAnschreibenRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/anschreiben/status') {
    const response: AnschreibenStatusResponse = { ...anschreibenRun.get(), current: anschreibenCurrent };
    respondJson(res, 200, response);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/anschreiben/stream') {
    attachSseClient(req, res, anschreibenSse);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/anschreiben') {
    const runId = beginRun(res, anschreibenRun, () => {
      anschreibenCurrent = undefined;
      anschreibenAbort = new AbortController();
    });
    if (!runId) return true;
    const abort = anschreibenAbort!;

    const body = await parseBodyOrDefault(() => readJsonBody<{ jobIds?: string[] }>(req), {});
    const jobIds = body.jobIds ?? [];

    try {
      await finishRun(anschreibenRun, async () => {
        // Nur triaged+nicht-brutal ist gültig (generateAnschreiben() prüft das selbst
        // nochmal) — hier vorab gefiltert, damit "skipped" korrekt zählt, statt
        // still Lücken aus fehlenden/ungeeigneten IDs zu übernehmen.
        const fetched = await Promise.all(jobIds.map(id => ctx.storage.get(id)));
        const jobs = fetched.filter((j): j is Job => j !== null && canGenerateAnschreiben(j));
        const preSkipped = jobIds.length - jobs.length;

        if (jobs.length === 0) {
          return { result: { generated: 0, skipped: preSkipped, emailsFound: 0, mailGenerated: 0, nomailGenerated: 0 } };
        }

        await ensureOllama();
        const { generated, skipped, emailsFound, mailGenerated, nomailGenerated } = await runAnschreiben({
          jobs,
          storage: ctx.storage,
          profile: ctx.profile,
          signal: abort.signal,
          onProgress: (i, total, title) => {
            anschreibenCurrent = { i, total, title };
          },
          onItemDone: item => anschreibenSse.broadcast({ section: runId, sectionLabel: 'Anschreiben', row: item.id, items: [item] }),
        });
        return {
          result: { generated, skipped: skipped + preSkipped, emailsFound, mailGenerated, nomailGenerated },
          status: abort.signal.aborted ? 'stopped' as const : 'done' as const,
        };
      });
      const snap = anschreibenRun.get();
      desktopNotify('JoBBoT — Anschreiben fertig', snap.status === 'error'
        ? `Fehlgeschlagen: ${snap.error ?? ''}`
        : snap.status === 'stopped'
          ? `Abgebrochen: ${snap.result?.generated ?? 0} generiert`
          : `${snap.result?.generated ?? 0} generiert, ${snap.result?.skipped ?? 0} übersprungen`);
    } finally {
      anschreibenAbort = null;
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/anschreiben/stop') {
    if (!anschreibenRun.isRunning() || !anschreibenAbort) {
      respondJson(res, 409, { stopped: false, reason: 'not-running' });
      return true;
    }
    anschreibenAbort.abort();
    respondJson(res, 200, { stopped: true });
    return true;
  }

  return false;
}
