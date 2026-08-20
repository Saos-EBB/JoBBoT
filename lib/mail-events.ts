import { readFile, writeFile } from 'node:fs/promises';
import type { SentMail } from '../mail/gmail.ts';
import { parseBewerbungsBetreff } from './mail-match.ts';

export const MAIL_EVENTS_PATH = 'data/mail-events.json';

// Eine gelabelte Bewerbungs-Mail, zu der es KEINEN Job (mehr) im Bestand gibt. Jobs mit
// Treffer brauchen hier nichts: die tragen ihr sentAt selbst und erscheinen darüber im
// Kalender — stünden sie zusätzlich hier, zählte derselbe Tag doppelt.
export interface MailEvent {
  date: string;
  company: string;
  title: string;
  to: string;
}

// Der Absender-Domain als Notnagel, wenn der Betreff nicht dem composeEmail()-Muster
// folgt (händisch geschriebene Bewerbung): "ahoi@ahoikapptn.com" → "ahoikapptn.com".
function beschriftung(mail: SentMail): { title: string; company: string } {
  const geparst = parseBewerbungsBetreff(mail.subject);
  if (geparst) return geparst;
  const empfaenger = mail.to[0] ?? '';
  return { title: mail.subject || '(kein Betreff)', company: empfaenger.slice(empfaenger.indexOf('@') + 1) || empfaenger };
}

export function toMailEvents(mails: SentMail[]): MailEvent[] {
  return mails
    .map(m => ({ date: m.date.toISOString(), to: m.to[0] ?? '', ...beschriftung(m) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadMailEvents(path = MAIL_EVENTS_PATH): Promise<MailEvent[]> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as MailEvent[];
  } catch {
    // Datei fehlt (noch nie gesynct) oder ist kaputt — beides heißt "keine Ereignisse",
    // und ein leerer Kalender ist hier die harmlosere Antwort als ein 500er.
    return [];
  }
}

// Vollständig überschreiben statt zu ergänzen: die Datei ist ein Abbild des Postfachs,
// kein Verlauf. Bekommt eine Mail später doch einen Job (weil job.email wieder da ist),
// verschwindet sie hier korrekt und erscheint stattdessen über das sentAt des Jobs.
export async function saveMailEvents(events: MailEvent[], path = MAIL_EVENTS_PATH): Promise<void> {
  await writeFile(path, JSON.stringify(events, null, 2), 'utf8');
}
