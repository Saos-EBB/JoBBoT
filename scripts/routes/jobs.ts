import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { findAnschreiben, anschreibenZiel } from '../../lib/anschreiben-datei.ts';
import { versende } from '../../lib/versand.ts';
import { respondJson, readJsonBody } from './http.ts';
import type { Ctx } from './context.ts';
import type { Job } from '../../scrapers/interface.ts';

async function readCoverLetter(job: { id: string }): Promise<string | null> {
  const path = await findAnschreiben(job);
  if (!path) return null;
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function handleJobsRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    const jobs = await ctx.storage.list();
    // brief lebt in data/anschreiben/{slug}.md, nicht im Job-JSON (siehe readCoverLetter
    // oben) — hier server-seitig gejoint, damit die Liste im Client die Anschreiben-
    // Vorschau zeigen kann, ohne 282 Einzel-Requests zu feuern. Der Join ist reines
    // Lesen; SPEICHERN einer Bearbeitung ist ein eigener Schreibpfad (anderer Endpunkt,
    // eigener Schritt), weil das Anschreiben nicht Teil des Job-Records ist.
    const withBriefs = await Promise.all(jobs.map(async job => ({ ...job, brief: await readCoverLetter(job) })));
    respondJson(res, 200, withBriefs);
    return true;
  }

  const jobPatchMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)$/);
  if (req.method === 'POST' && jobPatchMatch) {
    const job = await ctx.storage.get(jobPatchMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return true; }
    // status/fit (Aktionen entlang der Statusmaschine) und email (von Hand korrigierte
    // Empfängeradresse, siehe ui/app.tsx saveEmail) — keine serverseitige Allowlist,
    // weil dieser Server nur lokal auf localhost läuft und der Client ohnehin nie
    // andere Felder schickt.
    const patch = await readJsonBody<Partial<Pick<Job, 'status' | 'fit' | 'email'>>>(req);
    const updated = await ctx.storage.update(job.id, patch);
    respondJson(res, 200, updated);
    return true;
  }

  // Nachfass: eine Route für beide Wege, weil sich nur der letzte Schritt unterscheidet
  // (Entwurf anlegen vs. senden) — Betreff, Text und die Historie sind identisch.
  // Anders als /send ändert das den Status NICHT: die Bewerbung war schon gesendet und
  // bleibt es, ein Nachfass ist kein neuer Zustand, sondern ein weiterer Kontakt.
  const followUpMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/followup$/);
  if (req.method === 'POST' && followUpMatch) {
    const job = await ctx.storage.get(followUpMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return true; }
    let via: 'draft' | 'sent' = 'draft';
    try {
      via = (await readJsonBody<{ via?: 'draft' | 'sent' }>(req)).via === 'sent' ? 'sent' : 'draft';
    } catch {
      // kein Body — bleibt beim sichereren Entwurf
    }
    try {
      const updated = await versende({ job, art: 'nachfass', weg: via === 'sent' ? 'senden' : 'entwurf', storage: ctx.storage, profile: ctx.profile });
      respondJson(res, 200, updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respondJson(res, 500, { error: `Nachfass fehlgeschlagen: ${message}` });
    }
    return true;
  }

  const apiDraftMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/draft$/);
  if (req.method === 'POST' && apiDraftMatch) {
    const job = await ctx.storage.get(apiDraftMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return true; }
    try {
      const updated = await versende({ job, art: 'bewerbung', weg: 'entwurf', storage: ctx.storage, profile: ctx.profile });
      respondJson(res, 200, updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respondJson(res, 500, { error: `Entwurf fehlgeschlagen: ${message}` });
    }
    return true;
  }

  const apiSendMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/send$/);
  if (req.method === 'POST' && apiSendMatch) {
    const job = await ctx.storage.get(apiSendMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return true; }
    try {
      const updated = await versende({ job, art: 'bewerbung', weg: 'senden', storage: ctx.storage, profile: ctx.profile });
      respondJson(res, 200, updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respondJson(res, 500, { error: `Versand fehlgeschlagen: ${message}` });
    }
    return true;
  }

  const briefMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/brief$/);
  if (req.method === 'POST' && briefMatch) {
    const job = await ctx.storage.get(briefMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return true; }
    const { text } = await readJsonBody<{ text: string }>(req);
    // Gegenstück zum Join in GET /api/jobs: brief lebt in data/anschreiben/{slug}.md,
    // nicht im Job-JSON, also schreibt eine Bearbeitung dorthin statt über
    // storage.update() — ein Status-Wechsel und eine Anschreiben-Bearbeitung sind zwei
    // unabhängige Schreibpfade, die zufällig denselben Job betreffen.
    await writeFile(await anschreibenZiel(job), text, 'utf8');
    respondJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
