import { fetchInboxReplies, fetchSentMails, fetchReplyTexts, istBewerbung, type SentMail, type InboxReply } from '../mail/gmail.ts';
import { matchSent, classifyReplies, gehoertZuJob, type ReplyMatch } from './mail-match.ts';
import { strongerKind, htmlToText } from './reply-kind.ts';
import type { ReplyClassifier } from './reply-kind.ts';
import { createJevReplyClassifier } from './reply-kind-jev.ts';
import { HISTORY_START } from './calendar.ts';
import { saveMailEvents, toMailEvents, type MailEvent } from './mail-events.ts';
import { config } from '../config.ts';
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
//  2b. Ausnahme vom Lückenfüllen: replyKind (lib/reply-kind.ts) darf aufsteigen —
//     kommt nach der Eingangsbestätigung die Absage, gilt die Absage.
//  3. ändert keinen Status — mit EINER Ausnahme: ein Job im Postausgang (Bot hat den
//     Gmail-Entwurf angelegt), dessen Mail im Gesendet-Ordner auftaucht, wurde von dir
//     in Gmail abgeschickt → status "gesendet" + sentAt. Dafür zählen auch Mails ohne
//     Bewerbungs-Label (der Bot-Entwurf trägt keins); die Zuordnung ist dieselbe wie
//     sonst (exakter Betreff oder Empfängeradresse, mehrdeutig → nichts).
export interface GmailSyncResult {
  sentGescannt: number;
  // Postausgang → gesendet (Entwurf wurde in Gmail abgeschickt).
  postausgangGesendet: number;
  markiert: number;
  sentGefuellt: number;
  ohneJob: number;
  replyGescannt: number;
  replyGefuellt: number;
  // Jobs, die in diesem Lauf neu als Absage markiert wurden.
  absagen: number;
  // Jobs, deren Antwort-Art sich in diesem Lauf geändert hat (inkl. Absagen).
  artGesetzt: number;
  // Antworten ohne Urteil (JEV nicht erreichbar oder Antwort unbrauchbar).
  ohneArt: number;
  seit: string;
}

type TexteHolen = typeof fetchReplyTexts;

// Liest den Text jeder zugeordneten Antwort und hebt job.replyKind an, wenn die Antwort
// aussagekräftiger ist als die bisherige (lib/reply-kind.ts). Nur zugeordnete Antworten
// werden nachgeladen, nicht das ganze Postfach. Jobs, die schon "absage" tragen, sind
// fertig — ihre Mails werden nicht mehr geholt. Ohne Urteil (JEV nicht erreichbar)
// bleibt die Art unverändert und zählt als ohneArt.
interface ArtErgebnis { absagen: number; artGesetzt: number; ohneArt: number }

async function markiereAntwortArten(storage: Storage, matched: ReplyMatch[], texteHolen: TexteHolen, klassifiziere: ReplyClassifier): Promise<ArtErgebnis> {
  const offen = matched.filter(m => m.job.replyKind !== 'absage');
  const texte = await texteHolen(offen.flatMap(m => (m.reply.uid != null ? [m.reply.uid] : [])));
  const ergebnis: ArtErgebnis = { absagen: 0, artGesetzt: 0, ohneArt: 0 };
  for (const { job, reply } of offen) {
    const t = reply.uid != null ? texte.get(reply.uid) : undefined;
    const art = await klassifiziere(reply, t ? (t.html ? htmlToText(t.text) : t.text) : '');
    if (!art) { ergebnis.ohneArt++; continue; }
    // Frisch lesen: mehrere Antworten zum selben Job heben nacheinander an.
    const bisher = (await storage.get(job.id))?.replyKind;
    const neu = strongerKind(bisher, art);
    if (neu === bisher) continue;
    await storage.update(job.id, { replyKind: neu });
    ergebnis.artGesetzt++;
    if (neu === 'absage') ergebnis.absagen++;
  }
  return ergebnis;
}

export interface GmailSyncDeps {
  fetchSentMails: (since: Date) => Promise<SentMail[]>;
  fetchInboxReplies: (since: Date) => Promise<InboxReply[]>;
  saveMailEvents: (events: MailEvent[]) => Promise<void>;
  // Ohne Angabe der echte IMAP-Abruf; ohne UIDs (Tests) geht er nie ans Netz.
  fetchReplyTexts?: TexteHolen;
  // Deine eigene Adresse; ohne Angabe GMAIL_USER (config.gmailUser).
  ownAddress?: string;
  // Antwort-Art; ohne Angabe JEV (pro Lauf neu, lib/reply-kind-jev.ts). Regex als
  // Option: regexReplyClassifier aus lib/reply-kind.ts.
  classifyReply?: ReplyClassifier;
}

const defaultDeps: GmailSyncDeps = { fetchSentMails, fetchInboxReplies, saveMailEvents, fetchReplyTexts };

export async function runGmailSync(storage: Storage, deps: GmailSyncDeps = defaultDeps): Promise<GmailSyncResult> {
  const jobs = await storage.list();
  // Fester Startpunkt statt aus scrapedAt abgeleitet: gescannt wird der Zeitraum,
  // den auch der Kalender anzeigt (siehe HISTORY_START).
  const since = new Date(HISTORY_START);

  // Der Scan läuft auch ohne offene Jobs. Er schreibt dann nichts, aber die Zahl der
  // gelesenen Mails macht sichtbar, ob das Postfach überhaupt etwas hergibt — ein
  // stilles "0 ergänzt" verrät nicht, ob nichts da war oder nichts zugeordnet wurde.
  const alleSent = await deps.fetchSentMails(since);
  // Nur Bewerbungen (Betreff oder Label, siehe istBewerbung) — sonst landete jede
  // private Mail im Kalender. Mails nur an dich selbst (Tests, Notizen) zählen nie.
  const eigene = (deps.ownAddress ?? config.gmailUser)?.toLowerCase();
  const sentMails = alleSent.filter(m => istBewerbung(m) && !(eigene && m.to.every(a => a.toLowerCase() === eigene)));

  // Postausgang zuerst und gegen ALLE gesendeten Mails: nur Mails, die nach dem
  // Einlesen des Inserats rausgingen (ältere an dieselbe Adresse sind nicht diese
  // Bewerbung). Danach haben diese Jobs ein sentAt und fallen aus dem Label-Abgleich.
  let postausgangGesendet = 0;
  const imPostausgang = jobs.filter(j => j.status === 'postausgang' && !j.sentAt);
  const zugeordnet = new Set<SentMail>();
  for (const job of imPostausgang) {
    const nachher = alleSent.filter(m => m.date >= new Date(job.scrapedAt));
    // Alle Postausgang-Jobs mitgeben, nicht nur diesen: liegen zwei Stellen derselben
    // Firmenadresse im Postausgang, trennt matchSent sie über den Betreff (oder lässt's).
    const treffer = matchSent(nachher, imPostausgang).find(m => m.job.id === job.id);
    if (!treffer) continue;
    await storage.update(job.id, { status: 'gesendet', sentAt: treffer.date.toISOString() });
    zugeordnet.add(treffer.mail);
    postausgangGesendet++;
  }

  let sentGefuellt = 0;
  const restJobs = postausgangGesendet ? await storage.list() : jobs;
  for (const { job, date, mail } of matchSent(sentMails.filter(m => !zugeordnet.has(m)), restJobs)) {
    await storage.update(job.id, { sentAt: date.toISOString() });
    zugeordnet.add(mail);
    sentGefuellt++;
  }

  // Bewerbungs-Mails ohne Job: als eigene Kalender-Ereignisse ablegen, damit der
  // Zeitraum vollständig sichtbar ist statt an Lücken im Job-Bestand zu scheitern.
  // Nicht zugeordnet UND zu keinem Job passend — Mails zu Jobs, die ihr sentAt schon
  // hatten, sind keine eigenen Ereignisse (sonst doppelt im Kalender/Nachweis).
  const ohneJob = sentMails.filter(m => !zugeordnet.has(m) && !gehoertZuJob(m, restJobs));
  await deps.saveMailEvents(toMailEvents(ohneJob));

  // Frisch aus dem Sent-Scan gesetzte sentAt sollen sofort für die Antwort-Zuordnung
  // zählen, deshalb die Liste neu laden statt die veraltete weiterzureichen.
  const nachSent = await storage.list();
  const replies = await deps.fetchInboxReplies(since);
  let replyGefuellt = 0;
  const { matched } = classifyReplies(replies, nachSent);
  for (const { job, reply } of matched) {
    if (job.replyReceivedAt) continue; // Lücken füllen, nicht überschreiben
    await storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
    replyGefuellt++;
  }
  const art = await markiereAntwortArten(storage, matched, deps.fetchReplyTexts ?? fetchReplyTexts, deps.classifyReply ?? createJevReplyClassifier());

  return {
    sentGescannt: alleSent.length,
    postausgangGesendet,
    markiert: sentMails.length,
    sentGefuellt,
    ohneJob: ohneJob.length,
    replyGescannt: replies.length,
    replyGefuellt,
    ...art,
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
  // "gesendet ODER sentAt" wie matchReplies/isFollowUpCandidate — ein Job mit sentAt aus
  // dem Sync (Status noch nicht "gesendet") gehört genauso ins Scan-Fenster.
  const gesendet = jobs
    .filter(j => (j.status === 'gesendet' || j.sentAt) && j.email)
    .map(j => new Date(j.sentAt ?? j.updatedAt).getTime());
  return gesendet.length ? new Date(Math.min(...gesendet)) : null;
}

export interface ReplyFetchDeps {
  fetchInboxReplies: (since: Date) => Promise<InboxReply[]>;
  fetchReplyTexts?: TexteHolen;
  classifyReply?: ReplyClassifier;
}
const defaultReplyDeps: ReplyFetchDeps = { fetchInboxReplies, fetchReplyTexts };

// Eine mehrdeutige Antwort für die manuelle Zuordnung im UI: die Mail plus die offenen
// gesendeten Jobs derselben Firma, aus denen der Nutzer wählt.
export interface AmbiguousReplyView {
  reply: { from: string; subject: string; date: string };
  candidates: { id: string; title: string; company: string }[];
}

export interface ReplyFetchResult {
  checked: number;
  matched: number;
  absagen: number;
  artGesetzt: number;
  ohneArt: number;
  ambiguous: AmbiguousReplyView[];
}

// Der schnelle Antwort-Abruf. Füllt nur Lücken (if replyReceivedAt continue) — dieselbe
// Zusage wie runGmailSync. matched zählt nur die tatsächlich neu gesetzten Antworten;
// ambiguous sind die, die zwar zu einer Firma passen, aber nicht eindeutig einem Job —
// die legt der Nutzer im UI manuell auf einen Job (siehe /api/mail/replies/assign).
export async function fetchAndFillReplies(storage: Storage, deps: ReplyFetchDeps = defaultReplyDeps): Promise<ReplyFetchResult> {
  const jobs = await storage.list();
  const since = replyScanSince(jobs);
  if (!since) return { checked: 0, matched: 0, absagen: 0, artGesetzt: 0, ohneArt: 0, ambiguous: [] };

  const replies = await deps.fetchInboxReplies(since);
  const { matched, ambiguous } = classifyReplies(replies, jobs);

  let filled = 0;
  for (const { job, reply } of matched) {
    if (job.replyReceivedAt) continue; // Lücken füllen, nicht überschreiben
    await storage.update(job.id, { replyReceivedAt: reply.date.toISOString() });
    filled++;
  }
  const art = await markiereAntwortArten(storage, matched, deps.fetchReplyTexts ?? fetchReplyTexts, deps.classifyReply ?? createJevReplyClassifier());

  const byId = new Map(jobs.map(j => [j.id, j]));
  const ambiguousView: AmbiguousReplyView[] = ambiguous.map(a => ({
    reply: { from: a.reply.from, subject: a.reply.subject, date: a.reply.date.toISOString() },
    candidates: a.candidateJobIds
      .map(id => byId.get(id))
      .filter((j): j is Job => j != null)
      .map(j => ({ id: j.id, title: j.title, company: j.company })),
  }));

  return { checked: replies.length, matched: filled, ...art, ambiguous: ambiguousView };
}
