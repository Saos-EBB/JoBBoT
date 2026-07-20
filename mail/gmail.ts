import { readFile, appendFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type { Job } from '../scrapers/interface.ts';
import type { ProfileData } from '../lib/profile.ts';
import { jobBasename } from '../lib/slugify.ts';
import { config } from '../config.ts';
import { ATTACHMENT_PATH, ATTACHMENT_FILENAME } from '../lib/attachment.ts';
import { loadCc } from '../lib/cc.ts';

export const MAIL_LOG_PATH = 'data/mail-log.md';

export async function logMailAction(job: Job, action: 'drafted' | 'sent', logPath = MAIL_LOG_PATH): Promise<void> {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  await appendFile(logPath, `\n- ${ts}: ${action} — ${job.title} — ${job.company} — ${job.email}\n`);
}

export interface ComposedEmail {
  to: string;
  subject: string;
  text: string;
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

  const letterPath = join(config.anschreibenDir, `${jobBasename(job)}.md`);
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

// Anhang ist an dieser Stelle optional, nicht Pflicht: "kein Lebenslauf hochgeladen" ist ein
// gültiger, alltäglicher Zustand (siehe /api/attachment, GET liefert dafür regulär 404) — eine
// Mail darf deswegen nie fehlschlagen. Wer das später zur Pflicht macht, sollte das bewusst
// entscheiden, nicht als Nebeneffekt eines Refactors hier.
async function attachmentIfPresent(): Promise<{ filename: string; path: string }[]> {
  try {
    await stat(ATTACHMENT_PATH);
    return [{ filename: ATTACHMENT_FILENAME, path: ATTACHMENT_PATH }];
  } catch {
    return [];
  }
}

// nodemailers eigene (undokumentierte, aber öffentlich importierbare) MailComposer-Klasse
// statt Handgebautem — nötig, sobald ein Anhang dazukommt (multipart/mixed statt einteiliger
// Nachricht), und die Klasse baut den einteiligen Text-Fall identisch, siehe SESSION-LOG.
async function buildRawMessage(from: string, email: ComposedEmail): Promise<Buffer> {
  const mail = new MailComposer({
    from,
    to: email.to,
    cc: (await loadCc()) ?? undefined,
    subject: email.subject,
    text: email.text,
    attachments: await attachmentIfPresent(),
  });
  return mail.compile().build();
}

export async function createDraft(email: ComposedEmail): Promise<void> {
  if (config.mailDryRun) {
    const att = await attachmentIfPresent();
    const cc = await loadCc();
    console.log(`[MAIL_DRY_RUN] draft → ${email.to} — ${email.subject}${att.length ? ` (Anhang: ${att[0].filename})` : ''}${cc ? ` (CC: ${cc})` : ''}`);
    return;
  }
  const { user, pass } = requireGmailCredentials();
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
    await client.append('[Gmail]/Drafts', await buildRawMessage(user, email), ['\\Draft']);
  } finally {
    await client.logout();
  }
}

export async function sendMail(email: ComposedEmail): Promise<void> {
  const att = await attachmentIfPresent();
  const cc = await loadCc();
  if (config.mailDryRun) {
    console.log(`[MAIL_DRY_RUN] send → ${email.to} — ${email.subject}${att.length ? ` (Anhang: ${att[0].filename})` : ''}${cc ? ` (CC: ${cc})` : ''}`);
    return;
  }
  const { user, pass } = requireGmailCredentials();
  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transporter.sendMail({ from: user, to: email.to, cc: cc ?? undefined, subject: email.subject, text: email.text, attachments: att });
}
