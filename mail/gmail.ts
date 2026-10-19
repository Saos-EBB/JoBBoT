import { readFile, appendFile } from 'node:fs/promises';
import { ImapFlow, type MessageStructureObject } from 'imapflow';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type { Job } from '../scrapers/interface.ts';
import type { ProfileData } from '../lib/profile.ts';
import { findAnschreiben } from '../lib/anschreiben-datei.ts';
import { logTimestamp } from '../lib/log-timestamp.ts';
import { config } from '../config.ts';
import type { ComposedEmail, MailTransport } from './transport.ts';

// Re-Export statt zweiter Definition: der Typ gehört jetzt zum Transport-Seam
// (mail/transport.ts), die Aufrufer sollen ihn aber weiter von hier bekommen können.
export type { ComposedEmail } from './transport.ts';

export const MAIL_LOG_PATH = 'data/mail-log.md';

export async function logMailAction(job: Job, action: 'drafted' | 'sent' | 'followup-drafted' | 'followup-sent', logPath = MAIL_LOG_PATH): Promise<void> {
  const ts = logTimestamp();
  await appendFile(logPath, `\n- ${ts}: ${action} — ${job.title} — ${job.company} — ${job.email}\n`);
}

function requireGmailCredentials(): { user: string; pass: string } {
  const { gmailUser, gmailAppPassword } = config;
  if (!gmailUser || !gmailAppPassword) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD fehlen in .env');
  }
  return { user: gmailUser, pass: gmailAppPassword };
}

// Ein IMAP-Zugang für alle drei Stellen, die einen brauchen (entwurf, fetchSentMails,
// fetchInboxReplies) — vorher baute jede ihn sich einzeln zusammen. connect()/logout()
// sitzen jetzt genau einmal, logout() garantiert per finally auch wenn fn() wirft.
async function withImapClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const { user, pass } = requireGmailCredentials();
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout();
  }
}

// Nach "Sehr geehrte Damen und Herren," geht es klein weiter (DIN 5008 / ÖNORM A 1080).
// Der Brief kommt vom LLM aber als eigenständiger Text mit großem Satzanfang. Nur
// Funktionswörter werden kleingeschrieben — ein Substantiv oder Firmenname am Anfang
// bliebe sonst falsch klein.
const KLEIN_NACH_ANREDE = /^(Die|Der|Das|Den|Dem|Des|Ein|Eine|Einen|Einem|Einer|Mit|Als|An|Auf|Bei|Für|In|Im|Seit|Nach|Durch|Um|Von|Vom|Zu|Zur|Zum|Über|Unter|Gerade|Schon|Bereits|Nachdem|Da|Weil|Wenn|Ob|Besonders|Gerne|Gern|Meine|Mein|Meinem|Meinen|Meiner)\b/;

function kleinNachAnrede(text: string): string {
  return text.replace(KLEIN_NACH_ANREDE, w => w.toLowerCase());
}

// Signatur aus dem Profil; Platzhalter ("TODO …") bleiben draußen.
function signatur(profile: ProfileData): string {
  const links = [profile.links?.website, profile.links?.github].filter((l): l is string => !!l && !l.startsWith('TODO'));
  return [profile.name, ...links].join('\n');
}

export async function composeEmail(job: Job, profile: ProfileData): Promise<ComposedEmail> {
  if (!job.email) throw new Error(`Job ${job.id} hat keine E-Mail-Adresse`);

  const letterPath = await findAnschreiben(job);
  if (!letterPath) throw new Error(`Job ${job.id} hat kein Anschreiben in ${config.anschreibenDir}`);
  const body = kleinNachAnrede((await readFile(letterPath, 'utf8')).trim());

  return {
    to: job.email,
    subject: `Bewerbung als ${job.title} bei ${job.company}`,
    text: [
      'Sehr geehrte Damen und Herren,',
      '',
      body,
      '',
      'Meinen Lebenslauf finden Sie im Anhang, meine Projekte auf meiner Website.',
      '',
      'Mit freundlichen Grüßen',
      signatur(profile),
    ].join('\n'),
  };
}

// Nachfass zur schon abgeschickten Bewerbung. Der Betreff ist ABSICHTLICH identisch mit
// dem der Bewerbung: zum einen landet die Mail so im selben Gmail-Thread, zum anderen
// rekonstruiert lib/mail-match.ts genau diesen Betreff, um eingehende Antworten einem Job
// zuzuordnen ("Re: Bewerbung als X bei Y"). Ein eigener Nachfass-Betreff würde eine Antwort
// darauf am Betreff-Tiebreaker vorbeilaufen lassen.
//
// Kein Anschreiben-Text: der ist beim Empfänger schon, ein zweites Mal derselbe Brief
// liest sich wie ein kaputtes Skript (Kevin wollte deshalb ausdrücklich eine kurze Nachfrage).
export async function composeFollowUp(job: Job, profile: ProfileData): Promise<ComposedEmail> {
  if (!job.email) throw new Error(`Job ${job.id} hat keine E-Mail-Adresse`);

  // Ohne sentAt (Altbestand) bleibt der Satz datumslos, statt ein Datum zu erfinden.
  const datum = job.sentAt
    ? ` am ${new Date(job.sentAt).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : '';

  return {
    to: job.email,
    subject: `Bewerbung als ${job.title} bei ${job.company}`,
    text: [
      'Sehr geehrte Damen und Herren,',
      '',
      `ich habe mich${datum} bei Ihnen als ${job.title} beworben und möchte nachfragen, ob meine Unterlagen angekommen sind und wie der aktuelle Stand ist.`,
      '',
      'Über eine kurze Rückmeldung würde ich mich freuen.',
      '',
      'Mit freundlichen Grüßen',
      signatur(profile),
    ].join('\n'),
  };
}

// nodemailers eigene (undokumentierte, aber öffentlich importierbare) MailComposer-Klasse
// statt Handgebautem — nötig, sobald ein Anhang dazukommt (multipart/mixed statt einteiliger
// Nachricht), und die Klasse baut den einteiligen Text-Fall identisch, siehe SESSION-LOG.
function buildRawMessage(from: string, email: ComposedEmail): Promise<Buffer> {
  const mail = new MailComposer({
    from,
    to: email.to,
    cc: email.cc ?? undefined,
    subject: email.subject,
    text: email.text,
    attachments: email.attachments ?? [],
  });
  return mail.compile().build();
}

// Der echte Adapter am Transport-Seam. Kein MAIL_DRY_RUN-Zweig mehr: welcher Weg
// genommen wird, entscheidet lib/versand.ts beim Auswählen des Transports — hier
// wird ausschliesslich zugestellt.
export const gmailTransport: MailTransport = {
  name: 'gmail',

  async entwurf(email) {
    const { user } = requireGmailCredentials();
    await withImapClient(async client => {
      await client.append('[Gmail]/Drafts', await buildRawMessage(user, email), ['\\Draft']);
    });
  },

  async sende(email) {
    const { user, pass } = requireGmailCredentials();
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({
      from: user,
      to: email.to,
      cc: email.cc ?? undefined,
      subject: email.subject,
      text: email.text,
      attachments: email.attachments ?? [],
    });
  },
};

export interface InboxReply {
  from: string;
  subject: string;
  date: Date;
  // IMAP-UID in der INBOX — damit der Text nur für zugeordnete Antworten nachgeladen
  // wird (fetchReplyTexts), nicht für das ganze Postfach.
  uid?: number;
}

export interface SentMail {
  to: string[];
  subject: string;
  date: Date;
  labels: string[];
}

// Was im Gesendet-Ordner eine Bewerbung ist — automatisch, ohne Handarbeit in Gmail:
//  - "Bewerbung" im Betreff (der Bot schreibt "Bewerbung als <Titel> bei <Firma>"),
//    aber keine Antwort/Weiterleitung (Re:/AW:/WG:/Fwd:): die gehören zu einer
//    bestehenden Bewerbung und stünden sonst als zweite im Kalender und Nachweis;
//  - oder eins der Labels, auch als Unterlabel ("Bewerbungen/Beworben").
// Bis Oktober 2026 zählte NUR das Label, exakt verglichen — das Unterlabel
// "Bewerbungen/Beworben" passte nie, der Sync erkannte keine einzige Bewerbung.
export const BEWERBUNGS_LABELS = ['Bewerbung', 'Beworben'];

const ANTWORT_PRAEFIX = /^\s*(re|aw|wg|fw|fwd)\s*:/i;

export function istBewerbung(mail: SentMail): boolean {
  const label = mail.labels.some(l => {
    const name = l.toLowerCase().split('/').pop()!;
    return BEWERBUNGS_LABELS.some(b => name === b.toLowerCase());
  });
  return label || (/bewerbung/i.test(mail.subject) && !ANTWORT_PRAEFIX.test(mail.subject));
}

// Gmail lokalisiert den Gesendet-Ordner ("[Gmail]/Sent Mail" vs. "[Gmail]/Gesendet"),
// der Name ist also nicht hartkodierbar. Das IMAP-SPECIAL-USE-Flag "\Sent" ist
// sprachunabhängig; der hartkodierte Name bleibt nur als Notnagel für Server, die
// kein SPECIAL-USE melden.
async function sentMailboxPath(client: ImapFlow): Promise<string> {
  const boxes = await client.list();
  return boxes.find(b => b.specialUse === '\\Sent')?.path ?? '[Gmail]/Sent Mail';
}

// readOnly:true ist Absicht und keine Optimierung: der Sync darf nichts senden,
// löschen, verschieben oder auch nur als gelesen markieren.
export async function fetchSentMails(since: Date): Promise<SentMail[]> {
  return withImapClient(async client => {
    await client.mailboxOpen(await sentMailboxPath(client), { readOnly: true });
    const mails: SentMail[] = [];
    // labels:true liefert die Gmail-Labels mit (X-GM-EXT-1). Server ohne die Erweiterung
    // lassen msg.labels weg — dann bleibt die Liste leer und istBewerbung() filtert alles
    // weg, statt stillschweigend das ganze Postfach als Bewerbungen zu behandeln.
    for await (const msg of client.fetch({ since }, { envelope: true, labels: true })) {
      const to = (msg.envelope?.to ?? []).map(a => a.address).filter((a): a is string => !!a);
      if (to.length === 0) continue;
      mails.push({
        to,
        subject: msg.envelope?.subject ?? '',
        date: msg.envelope?.date ?? new Date(),
        labels: [...(msg.labels ?? [])],
      });
    }
    return mails;
  });
}

export async function fetchInboxReplies(since: Date): Promise<InboxReply[]> {
  return withImapClient(async client => {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const replies: InboxReply[] = [];
    for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
      const from = msg.envelope?.from?.[0]?.address;
      if (!from) continue;
      replies.push({ from, subject: msg.envelope?.subject ?? '', date: msg.envelope?.date ?? new Date(), uid: msg.uid });
    }
    return replies;
  });
}

// Erster Text-Teil einer Mail: text/plain bevorzugt, sonst text/html (Anhänge
// übersprungen). Einteilige Mails haben keine part-Nummer, dort ist der Body Teil "1".
function textTeil(node: MessageStructureObject | undefined, typ: string): string | null {
  if (!node) return null;
  if (node.childNodes?.length) {
    for (const kind of node.childNodes) {
      const treffer = textTeil(kind, typ);
      if (treffer) return treffer;
    }
    return null;
  }
  return node.type === typ && node.disposition !== 'attachment' ? node.part ?? '1' : null;
}

// Mailtexte zu INBOX-UIDs, read-only wie fetchInboxReplies. Text-Teile liefert imapflow
// bereits dekodiert und nach UTF-8 gewandelt. HTML bleibt HTML (der Aufrufer reduziert).
// Eine Mail, deren Text nicht lesbar ist, fehlt einfach in der Map.
export async function fetchReplyTexts(uids: number[]): Promise<Map<number, { text: string; html: boolean }>> {
  const texte = new Map<number, { text: string; html: boolean }>();
  if (uids.length === 0) return texte;
  return withImapClient(async client => {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const strukturen: { uid: number; bs?: MessageStructureObject }[] = [];
    for await (const msg of client.fetch(uids.join(','), { bodyStructure: true, uid: true }, { uid: true })) {
      strukturen.push({ uid: msg.uid, bs: msg.bodyStructure });
    }
    for (const { uid, bs } of strukturen) {
      const plain = textTeil(bs, 'text/plain');
      const part = plain ?? textTeil(bs, 'text/html');
      if (!part) continue;
      try {
        const { content } = await client.download(String(uid), part, { uid: true, maxBytes: 200_000 });
        const chunks: Buffer[] = [];
        for await (const c of content) chunks.push(c as Buffer);
        texte.set(uid, { text: Buffer.concat(chunks).toString('utf8'), html: !plain });
      } catch {
        // Einzelne kaputte Mail soll den Sync nicht kippen.
      }
    }
    return texte;
  });
}

