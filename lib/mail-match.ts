import type { Job } from '../scrapers/interface.ts';
import type { InboxReply, SentMail } from '../mail/gmail.ts';

export interface ReplyMatch {
  job: Job;
  reply: InboxReply;
}

export interface SentMatch {
  job: Job;
  date: Date;
}

function domain(email: string): string {
  return email.slice(email.indexOf('@') + 1).toLowerCase();
}

// Betreff wird nie gespeichert (siehe Recon Step 4), aber composeEmail() baut ihn
// immer deterministisch aus title+company — zur Matching-Zeit exakt neu berechenbar.
function reconstructedSubject(job: Job): string {
  return `bewerbung als ${job.title} bei ${job.company}`.toLowerCase();
}

// Antworten hängen "Re:"/"AW:" (deutsche Mail-Clients) vor den Originalbetreff.
function normalizeReplySubject(subject: string): string {
  return subject.replace(/^\s*(re|aw|antwort)\s*:\s*/i, '').trim().toLowerCase();
}

// Rückwirkende Zuordnung gesendeter Mails: die Message-ID wurde beim ursprünglichen
// Senden nie gespeichert, also ist das hier Heuristik und keine exakte Zuordnung.
// Bewusst simpel gehalten (kein Scoring): exakte Empfängeradresse zuerst, Betreff nur
// als Tiebreaker, wenn mehrere Jobs dieselbe Firmenadresse teilen. Bleibt es mehrdeutig,
// wird lieber nichts gesetzt als geraten — ein falsches sentAt wäre schlimmer als keines.
//
// Nur Jobs OHNE sentAt kommen infrage: der Sync füllt Lücken und überschreibt nie einen
// echten Wert aus dem Live-Versand.
export function matchSent(mails: SentMail[], jobs: Job[]): SentMatch[] {
  const offen = jobs.filter((j): j is Job & { email: string } => !!j.email && !j.sentAt);
  const matches: SentMatch[] = [];

  for (const job of offen) {
    const adresse = job.email.toLowerCase();
    const treffer = mails.filter(m => m.to.some(a => a.toLowerCase() === adresse));
    if (treffer.length === 0) continue;

    // Mehrere Jobs auf derselben (geteilten) Firmenadresse — nur der Betreff trennt sie.
    const geteilt = offen.filter(j => j.email.toLowerCase() === adresse).length > 1;
    const passend = geteilt
      ? treffer.filter(m => m.subject.trim().toLowerCase() === reconstructedSubject(job))
      : treffer;
    if (passend.length === 0) continue;

    // Älteste Mail an diese Adresse = die eigentliche Bewerbung; spätere sind Nachfassen.
    const datum = passend.reduce((a, b) => (a.date <= b.date ? a : b)).date;
    matches.push({ job, date: datum });
  }

  return matches;
}

// Primär: Absenderdomain gegen job.email. Sekundär: Betreff-Abgleich, nötig weil eine
// Firma dieselbe (geteilte) Inbox-Adresse für mehrere Stellen nutzen kann — ohne
// eindeutigen Betreff-Treffer wird eine mehrdeutige Domain lieber übersprungen als
// geraten zugeordnet.
export function matchReplies(replies: InboxReply[], jobs: Job[]): ReplyMatch[] {
  // "Wurde gesendet" heißt Status gesendet ODER ein sentAt aus dem rückwirkenden Sync —
  // der ändert per Auftrag keinen Status, seine Funde fielen sonst hier still durch.
  const gesendet = jobs.filter((j): j is Job & { email: string } => (j.status === 'gesendet' || !!j.sentAt) && !!j.email);
  const matches: ReplyMatch[] = [];

  for (const reply of replies) {
    const replyDomain = domain(reply.from);
    // sentAt ist das echte Sendedatum; updatedAt nur der Notnagel für Altbestand ohne sentAt.
    const candidates = gesendet.filter(j => domain(j.email) === replyDomain && new Date(j.sentAt ?? j.updatedAt) <= reply.date);
    if (candidates.length === 0) continue;

    const bySubject = candidates.filter(j => normalizeReplySubject(reply.subject) === reconstructedSubject(j));
    const best = bySubject.length === 1 ? bySubject[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (best) matches.push({ job: best, reply });
  }

  return matches;
}
