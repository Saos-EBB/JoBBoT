// Was für eine Antwort ist das? Für die Markierung im UI und den AMS-Nachweis.
// Ein Fehlurteil ist harmlos (es ist nur eine Markierung, der Status bleibt "gesendet").
//
//   absage      — die Firma sagt ab
//   zusage      — Einladung zum Gespräch/Test, Jobangebot, nächster Schritt
//   datenschutz — Bitte, einer Datenschutzerklärung/Einwilligung zuzustimmen
//   plattform   — Bitte, sich über ihr Bewerberportal (erneut) zu bewerben
//   eingang     — automatische Eingangsbestätigung ("Ihre Bewerbung ist eingegangen")
//   antwort     — nichts davon (Rückfrage, Abwesenheitsnotiz, …)
//
// Erkannt werden alle Arten von JEV (lib/reply-kind-jev.ts), das ist der Weg im Sync.
// classifyReply() hier ist die alte Regex-Erkennung — im Sync nicht mehr benutzt, bleibt
// als Option (regexReplyClassifier, z. B. ohne llama-server). Sie kennt nur absage und
// eingang und übersah viele Absagen und alle Portal-Bitten.
// Bewusst nur feste Wendungen — ein nacktes "leider" steht auch in "leider konnte ich
// Ihren Anhang nicht öffnen" und ist allein kein Absage-Signal.

export const REPLY_KINDS = ['absage', 'zusage', 'datenschutz', 'plattform', 'eingang', 'antwort'] as const;
export type ReplyKind = typeof REPLY_KINDS[number];

// Einstufung einer Antwort-Mail; null = kein Urteil (bleibt offen, nächster Sync versucht neu).
export type ReplyClassifier = (reply: { date: Date; from: string; subject: string }, text: string) => Promise<ReplyKind | null>;

// Geprüft wird auf whitespace-normalisiertem Text (Mails brechen mitten in der Wendung
// um), Leerzeichen in den Mustern sind also immer genau eins.
const ABSAGE = [
  /\babsage\b/i,
  /\b(position|stelle|bewerbung) (leider )?absagen\b/i,
  /\bleider\b[^.!?]{0,100}\b(kein\w*|nichts)\b[^.!?]{0,80}\b(anbieten|machen|geben|frei)\b/i,
  /\bandere\w* bewerber/i,
  /nicht (zu )?(einem )?(persönlichen )?(vorstellungs)?gespräch\w* (ein)?(zu )?laden/i,
  /nicht (weiter |länger )?berücksichtig/i,
  /nicht in die (engere|nähere) auswahl/i,
  /(für|zugunsten) (eine[nr]?|andere[nr]?) (andere[nr]? )?(kandidat|bewerber|person)/i,
  /(uns|wir haben uns) (leider )?(gegen ihre|für eine?n? andere)/i,
  /\banderweitig (besetzt|vergeben|entschieden)/i,
  /stelle (ist |wurde |konnte )?(bereits |zwischenzeitlich |mittlerweile )?(besetzt|vergeben)/i,
  /(keine|nicht die) (positive|erfreuliche) (nachricht|rückmeldung)/i,
  /nicht (weiter )?(verfolgen|fortsetzen|berücksichtigen)/i,
  /\b(leider )?(nicht|keine) (zusage|stelle) (geben|anbieten|machen)/i,
  /\bregret to inform\b/i,
  /\bnot (to )?(be )?mov(e|ing) forward\b/i,
  /\b(decided|chosen) to (proceed|move forward|go) with (other|another)/i,
  /\bposition has (already )?been filled\b/i,
  /\bunfortunately\b[^.]{0,120}\b(not|other candidates?)\b/i,
];

const EINGANG = [
  /eingangsbestätigung/i,
  /(ihre )?bewerbung (ist |wurde )?(bei uns |gut |erfolgreich )*(eingegangen|angekommen|erhalten)/i,
  /(haben|wir haben) ihre (bewerbung|unterlagen) (gut |erfolgreich )?erhalten/i,
  /\b(we have|we've) received your application\b/i,
  /\bthank you for (your application|applying)\b[^.]{0,80}\b(received|review)/i,
];

export function classifyReply(subject: string, text: string): ReplyKind {
  const alles = `${subject} ${text}`.replace(/\s+/g, ' ');
  if (ABSAGE.some(r => r.test(alles))) return 'absage';
  if (EINGANG.some(r => r.test(alles))) return 'eingang';
  return 'antwort';
}

// Die Regex-Erkennung als Klassifizierer für den Sync (GmailSyncDeps.classifyReply).
export const regexReplyClassifier: ReplyClassifier = async (reply, text) => classifyReply(reply.subject, text);

// Mehrere Antworten zu einem Job: die aussagekräftigste gewinnt. Eine Absage nach der
// Eingangsbestätigung überschreibt diese, nie umgekehrt; eine Absage nach der Einladung
// ebenso. Datenschutz/Plattform sind Aufgaben für dich — wichtiger als Eingang/Antwort,
// aber eine Einladung oder Absage danach sagt mehr.
const RANG: Record<ReplyKind, number> = { eingang: 0, antwort: 1, datenschutz: 2, plattform: 2, zusage: 3, absage: 4 };
export function strongerKind(a: ReplyKind | null | undefined, b: ReplyKind): ReplyKind {
  return a && RANG[a] >= RANG[b] ? a : b;
}

// HTML-Mail ohne Text-Teil: grob auf Text reduzieren, reicht für die Wendungs-Suche.
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü').replace(/&szlig;/g, 'ß').replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
    .replace(/[ \t]+/g, ' ');
}
