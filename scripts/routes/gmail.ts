import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchInboxReplies } from '../../mail/gmail.ts';
import { matchReplies } from '../../lib/mail-match.ts';
import { runGmailSync } from '../../lib/gmail-sync.ts';
import { respondJson } from './http.ts';
import type { Ctx } from './context.ts';

export type RepliesFetchResponse = { checked: number; matched: number };

export async function handleGmailRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'POST' && url.pathname === '/api/gmail-sync') {
    try {
      const result = await runGmailSync(ctx.storage);
      respondJson(res, 200, result);
    } catch (err) {
      respondJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  // Manuell auslösbarer Fetch statt Auto-Polling-Daemon (siehe Auftrag: Prototyp reicht
  // ein Button/eine Route, systemd-Scheduling wäre ein separater Auftrag).
  if (req.method === 'POST' && url.pathname === '/api/mail/replies/fetch') {
    try {
      const jobs = await ctx.storage.list();
      const gesendetDates = jobs.filter(j => j.status === 'gesendet' && j.email).map(j => new Date(j.updatedAt).getTime());
      if (gesendetDates.length === 0) {
        const response: RepliesFetchResponse = { checked: 0, matched: 0 };
        respondJson(res, 200, response);
        return true;
      }
      const since = new Date(Math.min(...gesendetDates));
      const replies = await fetchInboxReplies(since);
      const matches = matchReplies(replies, jobs);
      for (const { job, reply } of matches) {
        await ctx.storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
      }
      const response: RepliesFetchResponse = { checked: replies.length, matched: matches.length };
      respondJson(res, 200, response);
    } catch (err) {
      respondJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
