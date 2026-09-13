import { fetchInboxReplies, fetchSentMails, istBewerbung, type SentMail, type InboxReply } from '../mail/gmail.ts';
import { matchReplies, matchSent } from './mail-match.ts';
import { HISTORY_START } from './calendar.ts';
import { saveMailEvents, toMailEvents, type MailEvent } from './mail-events.ts';
import type { Storage } from '../storage/json-store.ts';
import type { Job } from '../scrapers/interface.ts';

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

// Fenster für den schnellen Antwort-Abruf (POST /api/mail/replies/fetch): ab der
// frühesten abgeschickten Bewerbung. sentAt ist das echte Sendedatum, updatedAt nur
// der Notnagel für Altbestand — dieselbe Rangfolge wie in matchReplies. Bewusst NICHT
// HISTORY_START wie runGmailSync: der Reply-Abruf ist der leichte Schnellcheck, der
// Full-Sync scannt den ganzen Kalenderzeitraum. Kein gesendeter Job → null (nichts zu
// scannen), der Aufrufer meldet dann 0/0.
export function replyScanSince(jobs: Job[]): Date | null {
  const gesendet = jobs
    .filter(j => j.status === 'gesendet' && j.email)
    .map(j => new Date(j.sentAt ?? j.updatedAt).getTime());
  return gesendet.length ? new Date(Math.min(...gesendet)) : null;
}

export interface ReplyFetchDeps {
  fetchInboxReplies: (since: Date) => Promise<InboxReply[]>;
}
const defaultReplyDeps: ReplyFetchDeps = { fetchInboxReplies };

export interface ReplyFetchResult {
  checked: number;
  matched: number;
}

// Der schnelle Antwort-Abruf, vorher inline & ungetestet im Route-Handler. Füllt jetzt
// nur Lücken (if replyReceivedAt continue) — dieselbe Zusage wie runGmailSync, die der
// Route bisher fehlte: sie überschrieb ein vorhandenes replyReceivedAt. matched zählt
// entsprechend nur die tatsächlich neu gesetzten Antworten.
export async function fetchAndFillReplies(storage: Storage, deps: ReplyFetchDeps = defaultReplyDeps): Promise<ReplyFetchResult> {
  const jobs = await storage.list();
  const since = replyScanSince(jobs);
  if (!since) return { checked: 0, matched: 0 };

  const replies = await deps.fetchInboxReplies(since);
  let matched = 0;
  for (const { job, reply } of matchReplies(replies, jobs)) {
    if (job.replyReceivedAt) continue; // Lücken füllen, nicht überschreiben
    await storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
    matched++;
  }
  return { checked: replies.length, matched };
}
