import type { Job } from '../scrapers/interface.ts';
import type { InboxReply } from '../mail/gmail.ts';

export interface ReplyMatch {
  job: Job;
  reply: InboxReply;
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

// Primär: Absenderdomain gegen job.email. Sekundär: Betreff-Abgleich, nötig weil eine
// Firma dieselbe (geteilte) Inbox-Adresse für mehrere Stellen nutzen kann — ohne
// eindeutigen Betreff-Treffer wird eine mehrdeutige Domain lieber übersprungen als
// geraten zugeordnet.
export function matchReplies(replies: InboxReply[], jobs: Job[]): ReplyMatch[] {
  const gesendet = jobs.filter((j): j is Job & { email: string } => j.status === 'gesendet' && !!j.email);
  const matches: ReplyMatch[] = [];

  for (const reply of replies) {
    const replyDomain = domain(reply.from);
    const candidates = gesendet.filter(j => domain(j.email) === replyDomain && new Date(j.updatedAt) <= reply.date);
    if (candidates.length === 0) continue;

    const bySubject = candidates.filter(j => normalizeReplySubject(reply.subject) === reconstructedSubject(j));
    const best = bySubject.length === 1 ? bySubject[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (best) matches.push({ job: best, reply });
  }

  return matches;
}
