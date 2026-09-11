import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadMailEvents } from '../../lib/mail-events.ts';
import type { Ctx } from './context.ts';

// Read-only, keine eigene Speicherung — reduziert Jobs auf Kalender-Ereignisse aus
// den bereits vorhandenen Feldern sentAt/replyReceivedAt (siehe scrapers/interface.ts).
// Gruppierung nach Monat/Woche macht die UI (ui/app.tsx Kalender-Tab), hier nur die
// flache Ereignisliste.
export async function handleCalendarRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/calendar') {
    const jobs = await ctx.storage.list();
    const events: { date: string; type: 'sent' | 'reply' | 'followup'; jobId: string | null; title: string; company: string }[] = [];
    for (const job of jobs) {
      if (job.sentAt) events.push({ date: job.sentAt.slice(0, 10), type: 'sent', jobId: job.id, title: job.title, company: job.company });
      // Jeder Nachfass ein eigener Eintrag, nicht nur der letzte: der Kalender soll
      // zeigen, WIE OFT und WANN nachgehakt wurde, nicht bloß dass es passiert ist.
      for (const fu of job.followUps ?? []) {
        events.push({ date: fu.at.slice(0, 10), type: 'followup', jobId: job.id, title: job.title, company: job.company });
      }
      if (job.replyReceivedAt) events.push({ date: job.replyReceivedAt.slice(0, 10), type: 'reply', jobId: job.id, title: job.title, company: job.company });
    }
    // Gelabelte Bewerbungs-Mails ohne Job im Bestand (siehe lib/mail-events.ts) — jobId
    // bleibt null, die UI zeigt sie als "nur Mail" ohne Sprung in die Detailansicht.
    for (const ev of await loadMailEvents()) {
      events.push({ date: ev.date.slice(0, 10), type: 'sent', jobId: null, title: ev.title, company: ev.company });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(events));
    return true;
  }
  return false;
}
