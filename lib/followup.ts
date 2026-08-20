import type { Job } from '../scrapers/interface.ts';

// Kevin: "auto resend nach 3 tagen keine Rückmeldung", wiederholt bis eine Antwort da
// ist — kein Limit. Die Uhr läuft ab dem letzten Kontakt, nicht ab sentAt, sonst wäre
// nach dem ersten Nachfass sofort wieder alles fällig.
export const FOLLOW_UP_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

// Letzter Kontakt in diese Richtung: der jüngste Nachfass, sonst das Sendedatum.
// followUps ist aufsteigend sortiert (siehe recordFollowUp), der letzte Eintrag ist
// damit der jüngste.
export function lastContactAt(job: Job): string | null {
  const last = job.followUps?.at(-1);
  return last?.at ?? job.sentAt ?? null;
}

export function daysSinceLastContact(job: Job, now: Date = new Date()): number | null {
  const last = lastContactAt(job);
  if (!last) return null;
  return Math.floor((now.getTime() - new Date(last).getTime()) / DAY_MS);
}

// Nachfass-fähig heisst: raus ist sie, eine Antwort kam nicht, und es gibt eine Adresse,
// an die überhaupt etwas gehen kann.
//
// "gesendet ODER sentAt" spiegelt lib/mail-match.ts: der rückwirkende Gmail-Sync setzt
// sentAt, ohne den Status anzufassen — nur auf den Status zu schauen liesse genau die
// Altbestände durchfallen, für die der Sync gebaut wurde. Gelöschtes ist raus: eine
// weggeräumte Bewerbung soll nicht weiter nachfassen.
export function isFollowUpCandidate(job: Job): boolean {
  if (job.status === 'geloescht') return false;
  if (job.status !== 'gesendet' && !job.sentAt) return false;
  if (job.replyReceivedAt) return false;
  return !!job.email;
}

export function isFollowUpDue(job: Job, now: Date = new Date()): boolean {
  if (!isFollowUpCandidate(job)) return false;
  const days = daysSinceLastContact(job, now);
  return days != null && days >= FOLLOW_UP_DAYS;
}

// Fällige zuerst die ältesten — wer am längsten wartet, steht oben.
export function dueFollowUps(jobs: Job[], now: Date = new Date()): Job[] {
  return jobs
    .filter(j => isFollowUpDue(j, now))
    .sort((a, b) => (lastContactAt(a) ?? '').localeCompare(lastContactAt(b) ?? ''));
}

// Hängt einen Nachfass an die Historie an, statt ein "letzter Nachfass"-Feld zu
// überschreiben: die Zahl der Versuche steht im UI, und ohne Historie liesse sich
// "3x nachgefasst, nie eine Antwort" hinterher nicht mehr belegen.
export function recordFollowUp(job: Job, via: 'draft' | 'sent', now: Date = new Date()): { at: string; via: 'draft' | 'sent' }[] {
  return [...(job.followUps ?? []), { at: now.toISOString(), via }];
}
