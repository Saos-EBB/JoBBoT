import { fetchInboxReplies, fetchSentMails, istBewerbung, type SentMail, type InboxReply } from '../mail/gmail.ts';
import { matchReplies, matchSent } from './mail-match.ts';
import { HISTORY_START } from './calendar.ts';
import { saveMailEvents, toMailEvents, type MailEvent } from './mail-events.ts';
import type { Storage } from '../storage/json-store.ts';

// Rückwirkender Sync: liest Gesendet-Ordner und INBOX und trägt nach, was in den
// Job-JSONs fehlt. Manuell ausgelöst wie die anderen Mail-Features (kein Daemon).
//
// Drei Zusagen, die hier bewusst im Code stehen und nicht nur im Auftrag:
//  1. read-only gegenüber Gmail — beide Ordner werden mit readOnly:true geöffnet,
//     nichts wird gesendet, gelöscht, verschoben oder als gelesen markiert;
//  2. füllt nur Lücken — ein vorhandenes sentAt/replyReceivedAt bleibt unangetastet,
//     damit ein heuristischer Treffer nie einen echten Wert überschreibt;
//  3. ändert keinen Status — geschrieben werden ausschließlich die zwei Datumsfelder.
export interface GmailSyncResult {
  sentGescannt: number;
  markiert: number;
  sentGefuellt: number;
  ohneJob: number;
  replyGescannt: number;
  replyGefuellt: number;
  seit: string;
}

export interface GmailSyncDeps {
  fetchSentMails: (since: Date) => Promise<SentMail[]>;
  fetchInboxReplies: (since: Date) => Promise<InboxReply[]>;
  saveMailEvents: (events: MailEvent[]) => Promise<void>;
}

const defaultDeps: GmailSyncDeps = { fetchSentMails, fetchInboxReplies, saveMailEvents };

export async function runGmailSync(storage: Storage, deps: GmailSyncDeps = defaultDeps): Promise<GmailSyncResult> {
  const jobs = await storage.list();
  // Fester Startpunkt statt aus scrapedAt abgeleitet: gescannt wird der Zeitraum,
  // den auch der Kalender anzeigt (siehe HISTORY_START).
  const since = new Date(HISTORY_START);

  // Der Scan läuft auch ohne offene Jobs. Er schreibt dann nichts, aber die Zahl der
  // gelesenen Mails macht sichtbar, ob das Postfach überhaupt etwas hergibt — ein
  // stilles "0 ergänzt" verrät nicht, ob nichts da war oder nichts zugeordnet wurde.
  const alleSent = await deps.fetchSentMails(since);
  // Nur was du in Gmail als Bewerbung markiert hast — sonst landete jede private
  // Mail im Kalender.
  const sentMails = alleSent.filter(istBewerbung);

  let sentGefuellt = 0;
  const zugeordnet = new Set<SentMail>();
  for (const { job, date, mail } of matchSent(sentMails, jobs)) {
    await storage.update(job.id, { sentAt: date.toISOString() });
    zugeordnet.add(mail);
    sentGefuellt++;
  }

  // Gelabelte Mails ohne Job: als eigene Kalender-Ereignisse ablegen, damit der
  // Zeitraum vollständig sichtbar ist statt an Lücken im Job-Bestand zu scheitern.
  const ohneJob = sentMails.filter(m => !zugeordnet.has(m));
  await deps.saveMailEvents(toMailEvents(ohneJob));

  // Frisch aus dem Sent-Scan gesetzte sentAt sollen sofort für die Antwort-Zuordnung
  // zählen, deshalb die Liste neu laden statt die veraltete weiterzureichen.
  const nachSent = await storage.list();
  const replies = await deps.fetchInboxReplies(since);
  let replyGefuellt = 0;
  for (const { job, reply } of matchReplies(replies, nachSent)) {
    if (job.replyReceivedAt) continue; // Lücken füllen, nicht überschreiben
    await storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
    replyGefuellt++;
  }

  return {
    sentGescannt: alleSent.length,
    markiert: sentMails.length,
    sentGefuellt,
    ohneJob: ohneJob.length,
    replyGescannt: replies.length,
    replyGefuellt,
    seit: HISTORY_START,
  };
}
