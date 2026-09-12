import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchInboxReplies, fetchSentMails, istBewerbung, type SentMail } from '../../mail/gmail.ts';
import { matchReplies, matchSent } from '../../lib/mail-match.ts';
import { HISTORY_START } from '../../lib/calendar.ts';
import { saveMailEvents, toMailEvents } from '../../lib/mail-events.ts';
import { respondJson } from './http.ts';
import type { Ctx } from './context.ts';

export async function handleGmailRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx): Promise<boolean> {
  // Rückwirkender Sync: liest Gesendet-Ordner und INBOX und trägt nach, was in den
  // Job-JSONs fehlt. Manuell ausgelöst wie die anderen Mail-Features (kein Daemon).
  //
  // Drei Zusagen, die hier bewusst im Code stehen und nicht nur im Auftrag:
  //  1. read-only gegenüber Gmail — beide Ordner werden mit readOnly:true geöffnet,
  //     nichts wird gesendet, gelöscht, verschoben oder als gelesen markiert;
  //  2. füllt nur Lücken — ein vorhandenes sentAt/replyReceivedAt bleibt unangetastet,
  //     damit ein heuristischer Treffer nie einen echten Wert überschreibt;
  //  3. ändert keinen Status — geschrieben werden ausschließlich die zwei Datumsfelder.
  if (req.method === 'POST' && url.pathname === '/api/gmail-sync') {
    try {
      const jobs = await ctx.storage.list();
      const kandidaten = jobs.filter(j => j.email && !j.sentAt);
      // Fester Startpunkt statt aus scrapedAt abgeleitet: gescannt wird der Zeitraum,
      // den auch der Kalender anzeigt (siehe lib/calendar.ts HISTORY_START).
      const since = new Date(HISTORY_START);

      // Der Scan läuft auch ohne Kandidaten. Er schreibt dann nichts, aber die Zahl der
      // gelesenen Mails macht sichtbar, ob das Postfach überhaupt etwas hergibt — ein
      // stilles "0 ergänzt" verrät nicht, ob nichts da war oder nichts zugeordnet wurde.
      const alleSent = await fetchSentMails(since);
      // Nur was du in Gmail als Bewerbung markiert hast — sonst landete jede private
      // Mail im Kalender.
      const sentMails = alleSent.filter(istBewerbung);
      let sentGefuellt = 0;
      const zugeordnet = new Set<SentMail>();
      for (const { job, date, mail } of matchSent(sentMails, jobs)) {
        await ctx.storage.update(job.id, { sentAt: date.toISOString() });
        zugeordnet.add(mail);
        sentGefuellt++;
      }

      // Gelabelte Mails ohne Job: als eigene Kalender-Ereignisse ablegen, damit der
      // Zeitraum vollständig sichtbar ist statt an Lücken im Job-Bestand zu scheitern.
      const ohneJob = sentMails.filter(m => !zugeordnet.has(m));
      await saveMailEvents(toMailEvents(ohneJob));

      // Frisch aus dem Sent-Scan gesetzte sentAt sollen sofort für die Antwort-Zuordnung
      // zählen, deshalb die Liste neu laden statt die veraltete weiterzureichen.
      const nachSent = await ctx.storage.list();
      const replies = await fetchInboxReplies(since);
      let replyGefuellt = 0;
      for (const { job, reply } of matchReplies(replies, nachSent)) {
        if (job.replyReceivedAt) continue; // Lücken füllen, nicht überschreiben
        await ctx.storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
        replyGefuellt++;
      }

      respondJson(res, 200, {
        sentGescannt: alleSent.length,
        markiert: sentMails.length,
        sentGefuellt,
        ohneJob: ohneJob.length,
        replyGescannt: replies.length,
        replyGefuellt,
        seit: HISTORY_START,
      });
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
        respondJson(res, 200, { checked: 0, matched: 0 });
        return true;
      }
      const since = new Date(Math.min(...gesendetDates));
      const replies = await fetchInboxReplies(since);
      const matches = matchReplies(replies, jobs);
      for (const { job, reply } of matches) {
        await ctx.storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
      }
      respondJson(res, 200, { checked: replies.length, matched: matches.length });
    } catch (err) {
      respondJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  return false;
}
