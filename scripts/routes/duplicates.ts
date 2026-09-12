import type { IncomingMessage, ServerResponse } from 'node:http';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../../config.ts';
import { findAnschreiben, anschreibenName } from '../../lib/anschreiben-datei.ts';
import { findDuplicates, planMerge } from '../../lib/duplicates.ts';
import { respondJson, readJsonBody } from './http.ts';
import type { Ctx } from './context.ts';

export async function handleDuplicatesRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/duplicates') {
    const jobs = await ctx.storage.list();
    const groups = findDuplicates(jobs);
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
      for (const job of plan.remove) await ctx.storage.deleteJob(job);
      // Alte Datei exakt löschen statt update() (das den Dateinamen aus dem
      // gepatchten scrapedAt neu ableitet — bei gleichem Zielordner bliebe die
      // alte Datei mit dem alten Namen sonst als Leiche liegen) und dann frisch
      // unter dem übernommenen scrapedAt speichern.
      await ctx.storage.deleteJob(plan.keep);
      await ctx.storage.save({ ...plan.keep, scrapedAt: plan.scrapedAt, updatedAt: new Date().toISOString() });
    }

    respondJson(res, 200, { merged: targets.length });
    return true;
  }

  return false;
}
