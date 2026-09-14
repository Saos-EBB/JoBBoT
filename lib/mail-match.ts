import type { Job } from '../scrapers/interface.ts';
import type { InboxReply, SentMail } from '../mail/gmail.ts';

export interface ReplyMatch {
  job: Job;
  reply: InboxReply;
}

export interface SentMatch {
  job: Job;
  date: Date;
  // Die zugeordnete Mail, damit der Aufrufer die übrigen (job-losen) auseinanderhalten
  // kann, ohne die Match-Regeln ein zweites Mal nachzubauen.
  mail: SentMail;
}

function domain(email: string): string {
  return email.slice(email.indexOf('@') + 1).toLowerCase();
}

// Betreff wird nie gespeichert (siehe Recon Step 4), aber composeEmail() baut ihn
// immer deterministisch aus title+company — zur Matching-Zeit exakt neu berechenbar.
function reconstructedSubject(job: Job): string {
  return `bewerbung als ${job.title} bei ${job.company}`.toLowerCase();
}

// Antworten hängen "Re:"/"AW:"/"WG:"/"Fwd:" (deutsche wie englische Clients) vor den
// Originalbetreff, oft mehrfach; Firmen-Gateways schieben zusätzlich Tags wie "[extern]"
// oder "[EXTERN]-" davor. Alle diese Präfixe/Tags wiederholt von vorne wegschälen und
// den Innen-Whitespace zusammenziehen — sonst rekonstruiert ein sonst exakter Betreff
// nicht (echt beobachtet: "AW: [extern]- Bewerbung als … " von einem ooeg.at-Absender).
function normalizeReplySubject(subject: string): string {
  let s = subject.trim();
  let prev: string;
  do {
    prev = s;
    s = s.replace(/^\s*(re|aw|antwort|wg|fwd|fw)\s*:\s*/i, '');
    s = s.replace(/^\s*\[[^\]]*\]\s*-?\s*/, '');
  } while (s !== prev);
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Rückwirkende Zuordnung gesendeter Mails: die Message-ID wurde beim ursprünglichen
// Senden nie gespeichert, also ist das hier Heuristik und keine exakte Zuordnung.
// Bewusst simpel gehalten (kein Scoring): exakte Empfängeradresse zuerst, Betreff nur
// als Tiebreaker, wenn mehrere Jobs dieselbe Firmenadresse teilen. Bleibt es mehrdeutig,
// wird lieber nichts gesetzt als geraten — ein falsches sentAt wäre schlimmer als keines.
//
// Nur Jobs OHNE sentAt kommen infrage: der Sync füllt Lücken und überschreibt nie einen
// echten Wert aus dem Live-Versand.
// Zwei gleichwertige Schlüssel statt nur der Adresse: job.email geht bei einem
// Re-Scrape oder Filter-Lauf verloren (die schreiben das Job-JSON neu), der Betreff
// dagegen ist aus title+company jederzeit rekonstruierbar. Wer nur die Adresse nimmt,
// verliert genau die Altbestände, für die der Sync gebaut wurde.
export function matchSent(mails: SentMail[], jobs: Job[]): SentMatch[] {
  const offen = jobs.filter(j => !j.sentAt);
  const matches: SentMatch[] = [];

  for (const job of offen) {
    const adresse = job.email?.toLowerCase();
    const betreff = reconstructedSubject(job);
    const treffer = mails.filter(m =>
      m.subject.trim().toLowerCase() === betreff
      || (!!adresse && m.to.some(a => a.toLowerCase() === adresse))
    );
    if (treffer.length === 0) continue;

    // Mehrere offene Jobs auf derselben Firmenadresse — dann trennt nur der Betreff.
    // Bleibt es mehrdeutig, wird übersprungen statt geraten.
    const geteilt = !!adresse && offen.filter(j => j.email?.toLowerCase() === adresse).length > 1;
    const passend = geteilt
      ? treffer.filter(m => m.subject.trim().toLowerCase() === betreff)
      : treffer;
    if (passend.length === 0) continue;

    // Älteste Mail an diese Adresse = die eigentliche Bewerbung; spätere sind Nachfassen.
    const aelteste = passend.reduce((a, b) => (a.date <= b.date ? a : b));
    matches.push({ job, date: aelteste.date, mail: aelteste });
  }

  return matches;
}

// Gegenstück zu composeEmail(): holt Titel und Firma aus "Bewerbung als X bei Y"
// zurück. Nötig für gelabelte Mails, zu denen es keinen Job (mehr) gibt — ohne das
// stünde im Kalender nur eine nackte E-Mail-Adresse.
export function parseBewerbungsBetreff(subject: string): { title: string; company: string } | null {
  const m = subject.trim().match(/^Bewerbung als (.+) bei (.+)$/i);
  return m ? { title: m[1].trim(), company: m[2].trim() } : null;
}

// Eine Antwort, die zu einer gesendeten Bewerbung gehört (Domain passt), aber nicht
// eindeutig EINEM Job zugeordnet werden kann — mehrere offene Jobs derselben Firma, und
// der Betreff ("Ihre Bewerbung") sagt nicht welcher. candidateJobIds sind die offenen
// Kandidaten; die Zuordnung trifft der Mensch (siehe /api/mail/replies/assign).
export interface AmbiguousReply {
  reply: InboxReply;
  candidateJobIds: string[];
}

export interface ReplyClassification {
  matched: ReplyMatch[];
  ambiguous: AmbiguousReply[];
}

// Ordnet eingehende Antworten den gesendeten Bewerbungen zu und trennt dabei die sicher
// zuordenbaren von den mehrdeutigen. Reihenfolge der Signale:
//  1. Betreff schlägt Domain: rekonstruiert der Voll-Betreff EINDEUTIG einen gesendeten
//     Job, wird er zugeordnet — egal von welcher Absender-Domain. Firmen antworten oft
//     von einer anderen Domain als der beworbenen (Tochter/ATS/Weiterleitung); ein
//     exakter Betreff-Treffer ist stärker als Domain-Gleichheit (echt beobachtet:
//     starlim-sterner.com → sterner-tools.com, develite-it-solutions.com → develite.at).
//  2. Domain + eindeutiger Betreff, oder Domain mit nur einem offenen Job → zugeordnet.
//  3. Domain passt, aber mehrere offene Jobs und kein eindeutiger Betreff → mehrdeutig,
//     zur manuellen Zuordnung angeboten statt geraten.
export function classifyReplies(replies: InboxReply[], jobs: Job[]): ReplyClassification {
  // "Wurde gesendet" heißt Status gesendet ODER ein sentAt aus dem rückwirkenden Sync —
  // der ändert per Auftrag keinen Status, seine Funde fielen sonst hier still durch.
  const gesendet = jobs.filter((j): j is Job & { email: string } => (j.status === 'gesendet' || !!j.sentAt) && !!j.email);
  const matched: ReplyMatch[] = [];
  const ambiguous: AmbiguousReply[] = [];

  for (const reply of replies) {
    // sentAt ist das echte Sendedatum; updatedAt nur der Notnagel für Altbestand ohne sentAt.
    const sentBefore = (j: Job) => new Date(j.sentAt ?? j.updatedAt) <= reply.date;
    const subjectMatches = (j: Job) => normalizeReplySubject(reply.subject) === reconstructedSubject(j);

    // 1) Betreff schlägt Domain — nur bei GENAU einem Treffer (sonst mehrdeutig).
    const bySubjectAll = gesendet.filter(j => sentBefore(j) && subjectMatches(j));
    if (bySubjectAll.length === 1) { matched.push({ job: bySubjectAll[0], reply }); continue; }

    // 2) Domain-basiert.
    const replyDomain = domain(reply.from);
    const candidates = gesendet.filter(j => domain(j.email) === replyDomain && sentBefore(j));
    if (candidates.length === 0) continue; // keine Domain-Verbindung → nicht anfassen, nicht anbieten

    const bySubject = candidates.filter(subjectMatches);
    if (bySubject.length === 1) { matched.push({ job: bySubject[0], reply }); continue; }
    if (candidates.length === 1) { matched.push({ job: candidates[0], reply }); continue; }

    // 3) Domain passt, mehrdeutig → offene Kandidaten zur manuellen Zuordnung anbieten.
    const offen = candidates.filter(j => !j.replyReceivedAt);
    if (offen.length > 0) ambiguous.push({ reply, candidateJobIds: offen.map(j => j.id) });
  }

  return { matched, ambiguous };
}

// Rückwärtskompatible Hülle: die sicheren Zuordnungen (runGmailSync/fetchAndFillReplies
// füllen daraus replyReceivedAt).
export function matchReplies(replies: InboxReply[], jobs: Job[]): ReplyMatch[] {
  return classifyReplies(replies, jobs).matched;
}
