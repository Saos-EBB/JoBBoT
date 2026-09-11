import { readFile, appendFile } from 'node:fs/promises';
import { ImapFlow } from 'imapflow';
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

export async function composeEmail(job: Job, profile: ProfileData): Promise<ComposedEmail> {
  if (!job.email) throw new Error(`Job ${job.id} hat keine E-Mail-Adresse`);

  const letterPath = await findAnschreiben(job);
  if (!letterPath) throw new Error(`Job ${job.id} hat kein Anschreiben in ${config.anschreibenDir}`);
  const body = (await readFile(letterPath, 'utf8')).trim();

  const cvLink = profile.links?.website && !profile.links.website.startsWith('TODO')
    ? `\n\nLebenslauf: ${profile.links.website}`
    : '';

  return {
    to: job.email,
    subject: `Bewerbung als ${job.title} bei ${job.company}`,
    text: `Sehr geehrte Damen und Herren,\n\n${body}\n\nMit freundlichen Grüßen\n${profile.name}${cvLink}\n\nFalls Interesse an meinen Projekten besteht: saos-repo.vercel.app`,
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
      `ich habe mich${datum} bei Ihnen als ${job.title} beworben und wollte höflich nachfragen, ob meine Unterlagen angekommen sind und wie der aktuelle Stand ist.`,
      '',
      'Über eine kurze Rückmeldung würde ich mich freuen.',
      '',
      'Mit freundlichen Grüßen',
      profile.name,
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
    const { user, pass } = requireGmailCredentials();
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
    await client.connect();
    try {
      await client.append('[Gmail]/Drafts', await buildRawMessage(user, email), ['\\Draft']);
    } finally {
      await client.logout();
    }
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
}

export interface SentMail {
  to: string[];
  subject: string;
  date: Date;
  labels: string[];
}

// Gmail-Labels, mit denen du eine gesendete Mail als Bewerbung markierst. Der Sync
// zieht ausschließlich so markierte Mails — das ist die verlässlichste Quelle dafür,
// was überhaupt eine Bewerbung war: job.email geht bei Re-Scrapes verloren und der
// Betreff ändert sich, wenn ein Inserat neu eingelesen wird, aber dein Label bleibt.
export const BEWERBUNGS_LABELS = ['Bewerbung', 'Beworben'];

export function istBewerbung(mail: SentMail): boolean {
  return mail.labels.some(l => BEWERBUNGS_LABELS.some(b => l.toLowerCase() === b.toLowerCase()));
}

// Gmail lokalisiert den Gesendet-Ordner ("[Gmail]/Sent Mail" vs. "[Gmail]/Gesendet"),
// der Name ist also nicht hartkodierbar. Das IMAP-SPECIAL-USE-Flag "\Sent" ist
// sprachunabhängig; der hartkodierte Name bleibt nur als Notnagel für Server, die
// kein SPECIAL-USE melden.
async function sentMailboxPath(client: ImapFlow): Promise<string> {
  const boxes = await client.list();
  return boxes.find(b => b.specialUse === '\\Sent')?.path ?? '[Gmail]/Sent Mail';
}

// Derselbe ImapFlow-Zugang wie gmailTransport.entwurf()/fetchInboxReplies(), hier lesend auf den
// Gesendet-Ordner. readOnly:true ist Absicht und keine Optimierung: der Sync darf nichts
// senden, löschen, verschieben oder auch nur als gelesen markieren.
export async function fetchSentMails(since: Date): Promise<SentMail[]> {
  const { user, pass } = requireGmailCredentials();
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
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
  } finally {
    await client.logout();
  }
}

// Derselbe ImapFlow-Zugang wie gmailTransport.entwurf() (gleicher Host/Auth) — nur eine
// Verbindungslogik, hier für Lesen statt Schreiben verwendet.
export async function fetchInboxReplies(since: Date): Promise<InboxReply[]> {
  const { user, pass } = requireGmailCredentials();
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
    await client.mailboxOpen('INBOX', { readOnly: true });
    const replies: InboxReply[] = [];
    for await (const msg of client.fetch({ since }, { envelope: true })) {
      const from = msg.envelope?.from?.[0]?.address;
      if (!from) continue;
      replies.push({ from, subject: msg.envelope?.subject ?? '', date: msg.envelope?.date ?? new Date() });
    }
    return replies;
  } finally {
    await client.logout();
  }
}

