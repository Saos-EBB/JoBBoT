import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { getProvider } from './llm/index.ts';
import { askField, defaultAsk, primer } from './nimble-client.ts';
import type { Ask, Choice } from './nimble-client.ts';
import type { ReplyClassifier, ReplyKind } from './reply-kind.ts';

// Antwort-Art per JEV (lib/nimble-client.ts): ein Aufruf pro Mail, Antwort ein Buchstabe.
// Kontext ist Betreff + Mailtext ohne zitierte Bewerbung (die eigene Mail darunter
// würde sonst mitbewertet), gekürzt auf CONTEXT_CHARS.

const CONTEXT_CHARS = 1500;

const CHOICES: Choice<ReplyKind>[] = [
  { code: 'A', label: 'absage', description: 'Absage: die Firma lehnt die Bewerbung ab, die Stelle ist vergeben oder die Bewerbung wird nicht weiter berücksichtigt' },
  { code: 'B', label: 'zusage', description: 'Zusage oder nächster Schritt: Einladung zu Gespräch, Kennenlernen, Telefonat oder Test, Jobangebot, Terminvorschlag' },
  { code: 'C', label: 'datenschutz', description: 'Bitte, einer Datenschutzerklärung oder Einwilligung zur Datenverarbeitung zuzustimmen (Link oder Formular), damit die Bewerbung bearbeitet oder gespeichert werden darf' },
  { code: 'D', label: 'plattform', description: 'Bitte, sich über das Bewerberportal, die Karriereseite oder ein Online-Formular der Firma (erneut) zu bewerben oder die Unterlagen dort hochzuladen' },
  { code: 'E', label: 'eingang', description: 'automatische Eingangsbestätigung: die Bewerbung ist angekommen, noch ohne Entscheidung' },
  { code: 'F', label: 'antwort', description: 'nichts davon (Rückfrage, Abwesenheitsnotiz, sonstige Antwort)' },
];

const SCHEMA = JSON.stringify({
  fields: [{ name: 'antwort_art', description: 'Was für eine Antwort auf eine Bewerbung ist diese E-Mail?', choices: CHOICES }],
});
const PREFIX = `Schema:\n${SCHEMA}\n\nContext:\n`;

// Zitierte Vorgänger-Mail abschneiden: ab "Am … schrieb", "-----Original", einem
// "Von:/From:"-Block oder der ersten ">"-Zeile.
export function stripQuoted(text: string): string {
  const cut = text.search(/^\s*(>|-{2,}\s*(Original|Ursprüngliche)|(Von|From):\s|Am .{5,80}schrieb|On .{5,80}wrote)/im);
  return (cut >= 0 ? text.slice(0, cut) : text).replace(/\s+/g, ' ').trim();
}

export function buildReplyPrompt(subject: string, text: string): string {
  const body = stripQuoted(text).slice(0, CONTEXT_CHARS);
  return `${PREFIX}Betreff: ${subject}\n${body}\n\nField: antwort_art`;
}

// Was eine Mail eindeutig macht, ohne ihren Text zu speichern.
export const replyKey = (r: { date: Date; from: string; subject: string }) => `${r.date.toISOString()}|${r.from}|${r.subject}`;

export interface JevReplyOptions {
  ask?: Ask;
  // Urteile pro Mail (replyKey → Art), damit jeder Sync nur NEUE Mails ans Modell gibt —
  // der Sync stuft sonst bei jedem Lauf alle zugeordneten Antworten neu ein.
  cachePath?: string;
  // Vor dem ersten Aufruf: Server erreichbar machen. Wirft er, bleibt im ganzen Lauf jede
  // neue Mail ohne Urteil (null) — der Sync scheitert nicht am Modell, der nächste Lauf
  // versucht es neu.
  ensureReady?: () => Promise<void>;
}

async function readCache(path: string): Promise<Record<string, ReplyKind>> {
  try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, ReplyKind>; } catch { return {}; }
}

async function writeCache(path: string, cache: Record<string, ReplyKind>): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, path);
}

export function createJevReplyClassifier(options: JevReplyOptions = {}): ReplyClassifier {
  const ask = options.ask ?? defaultAsk();
  const cachePath = options.cachePath ?? join(config.dataDir, '..', 'reply-kinds.json');
  const ensureReady = options.ensureReady ?? (() => getProvider().ensureReady());
  const prime = primer(ask, () => PREFIX);
  let ready: Promise<boolean> | null = null;
  let cache: Promise<Record<string, ReplyKind>> | null = null;

  return async (reply, text) => {
    cache ??= readCache(cachePath);
    const known = (await cache)[replyKey(reply)];
    if (known) return known;

    ready ??= ensureReady().then(() => true, () => false);
    if (!(await ready)) return null;

    await prime();
    const kind = await askField(ask, buildReplyPrompt(reply.subject, text), CHOICES);
    // Kein Urteil (Müll oder Netzwerkfehler) → null, nicht cachen: beim nächsten Sync darf
    // JEV es nochmal versuchen.
    if (!kind) return null;
    const c = await cache;
    c[replyKey(reply)] = kind;
    await writeCache(cachePath, c);
    return kind;
  };
}
