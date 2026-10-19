import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadMailEvents } from '../../lib/mail-events.ts';
import { nachweisHtml, nachweisZeilen } from '../../lib/nachweis.ts';
import type { Ctx } from './context.ts';

// Bewerbungsnachweis fürs AMS (lib/nachweis.ts): eigene Seite statt Teil der SPA, damit
// sie im neuen Tab sauber druckt. ?von=YYYY-MM-DD&bis=YYYY-MM-DD optional.
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export async function handleNachweisRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method !== 'GET' || url.pathname !== '/nachweis') return false;
  const von = url.searchParams.get('von') ?? '';
  const bis = url.searchParams.get('bis') ?? '';
  const zeitraum = { von: DATUM.test(von) ? von : undefined, bis: DATUM.test(bis) ? bis : undefined };
  const zeilen = nachweisZeilen(await ctx.storage.list(), await loadMailEvents(), zeitraum);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(nachweisHtml(zeilen, { name: ctx.profile.name, zeitraum, stand: new Date() }));
  return true;
}
