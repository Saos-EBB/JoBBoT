import type { IncomingMessage, ServerResponse } from 'node:http';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../../config.ts';
import { findAnschreiben, anschreibenName } from '../../lib/anschreiben-datei.ts';
import { findDuplicates, mergeGroups, type DuplicateGroup, type MergeBriefOps } from '../../lib/duplicates.ts';
import { respondJson, readJsonBody } from './http.ts';
import type { Ctx } from './context.ts';

// Der Brief lebt als eigene .md-Datei (nicht im Job-JSON) — hier die echte
// Datei-/Slug-Anbindung für mergeGroups().
const briefOps: MergeBriefOps = {
  find: job => findAnschreiben(job),
  carry: (from, to) => rename(from, join(config.anschreibenDir, `${anschreibenName(to)}.md`)),
};

export type DuplicatesResponse = DuplicateGroup[];
export type MergeResponse = { merged: number };

export async function handleDuplicatesRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/duplicates') {
    const jobs = await ctx.storage.list();
    const groups: DuplicatesResponse = findDuplicates(jobs);
    respondJson(res, 200, groups);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/duplicates/merge') {
    let keys: string[] | 'all' = [];
    try {
      const parsed = await readJsonBody<{ keys?: string[]; all?: boolean }>(req);
      keys = parsed.all ? 'all' : (parsed.keys ?? []);
    } catch {
      // leer bleiben — behandelt wie "keine Auswahl"
    }

    const jobs = await ctx.storage.list();
    const groups = findDuplicates(jobs);
    const targets = keys === 'all' ? groups : groups.filter(g => keys.includes(g.key));

    const merged = await mergeGroups(targets, ctx.storage, briefOps);

    const response: MergeResponse = { merged };
    respondJson(res, 200, response);
    return true;
  }

  return false;
}
