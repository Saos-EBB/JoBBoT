import type { IncomingMessage, ServerResponse } from 'node:http';
import { runGmailSync, fetchAndFillReplies, type ReplyFetchResult } from '../../lib/gmail-sync.ts';
import { respondJson } from './http.ts';
import type { Ctx } from './context.ts';

export type RepliesFetchResponse = ReplyFetchResult;

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
      const result = await fetchAndFillReplies(ctx.storage);
      respondJson(res, 200, result);
    } catch (err) {
      respondJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
