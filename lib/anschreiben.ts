import { mkdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { logTimestamp } from './log-timestamp.ts';
import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/json-store.ts';
import type { ProfileData } from './profile.ts';
import { anschreibenZiel } from './anschreiben-datei.ts';
import { canGenerateAnschreiben } from './folders.ts';
import { getProvider } from './llm/index.ts';
import { loadSettings } from './settings.ts';
import { config } from '../config.ts';

export const SYSTEM = `Du bist ein erfahrener Karriereberater. Du schreibst präzise, authentische Bewerbungsanschreiben auf Deutsch.
ABSOLUTE REGELN — niemals brechen:
- KEINE Anrede (nicht "Sehr geehrte Damen und Herren", nicht "Hallo")
- KEINE Grußformel (nicht "Mit freundlichen Grüßen", nicht "Hochachtungsvoll")
- KEIN Name des Bewerbers im Text
- KEINE Platzhalter wie [Name] oder [Datum]
- KEINE Fragen als Einstieg
- KEINE Floskeln: nicht "hiermit bewerbe ich mich", nicht "entzückt", nicht "fasziniert", nicht "auf den Weg begeben"
- Genau 3 Absätze, maximal 180 Wörter gesamt
- Nur Fließtext — keine Aufzählungen, keine Überschriften
- Antwort enthält NUR den Anschreiben-Text, absolut nichts sonst
- Nur Skills/Erfahrungen nennen, die wörtlich im Bewerber-Profil stehen. Nichts erfinden.
- Erfinde KEINE Technologie, Firma oder Produkt, das nicht wörtlich im Posting oder in profile.json
  steht. Nur Begriffe aus diesen zwei Quellen.
- Fordert die Stelle einen Skill, der im Profil fehlt: die Lücke in EINEM nüchternen Satz benennen —
  was fehlt und welche echte Erfahrung daneben liegt. Die genannte Erfahrung muss sachlich zum
  fehlenden Skill passen (Docker-Container → Cloud-Betrieb ja, Docker → "Azure-Kenntnisse" nein).
  NIE die Nähe als vorhandene Kompetenz verkaufen oder den geforderten Skill selbst behaupten.
  Nicht nach dem Muster "Da ich bisher … freue ich mich darauf …", sondern so:
  "Azure habe ich noch nicht eingesetzt; meine Services laufen bisher in Docker-Containern."
- Kein Skill ohne Beleg: jede genannte Fähigkeit braucht ein konkretes Projekt/Kontext aus dem Profil,
  nie eine nackte Aufzählung.
- Stehen mehrere Projekte im Profil: nicht zweimal dasselbe Projekt als Beleg nutzen. Jedes
  im Profil gelistete Projekt darf höchstens einmal vorkommen.
- Keine vorgegebenen Satzanfänge — der Einstieg muss von Job zu Job variieren.
Überstrapazierte Wörter — statt dessen:
- "fundiert(e Kenntnisse)" → sagen, was konkret gebaut wurde ("habe mit NestJS ein Backend gebaut")
- "reizt mich (sehr)" → benennen, was an der Stelle interessiert ("An … interessiert mich …")
- "freue mich darauf/auf" → sagen, was der Bewerber tun will ("Ich möchte …")
- "strukturierte Arbeitsweise", "Lernbereitschaft" → nicht behaupten, ein Projekt-Detail zeigt es
- "ideale Möglichkeit/Grundlage" → weglassen
- "die nächsten Schritte in meiner (fachlichen) Entwicklung" → die Aufgabe nennen und was der Bewerber daran tun will
- "Als Quereinsteiger …" als Satzanfang → nie. Der Quereinstieg ist kein Makel zum Erklären, sondern
  die Stärke aus dem Hintergrund (siehe "Hintergrund" im Profil): darauf aufbauen. Keine früheren
  Berufe nennen oder erfinden, die nicht im Profil stehen.`;

export function buildAnschreibenPrompt(job: Job, profile: ProfileData): string {
  const desc = job.description.slice(0, 1200);
  const alleSkills = [
    ...profile.skills.sprachen,
    ...profile.skills.frontend,
    ...profile.skills.backend,
    ...profile.skills.datenbanken,
  ].join(', ');
  // Anchor-Projekte (aktuelle/wichtigste Projekte) haben Vorrang vor der reinen
  // Array-Reihenfolge — sonst fällt z.B. das laufende JobBot-Projekt hinten runter,
  // nur weil es nicht zufällig unter den ersten zwei Einträgen steht.
  const anchors = profile.projekte.filter(p => p.anchor);
  const rest = profile.projekte.filter(p => !p.anchor);
  const projekteText = [...anchors, ...rest]
    .slice(0, 2)
    .map(p => `${p.name}: ${p.beschreibung}${p.tech ? ` (Tech: ${p.tech.join(', ')})` : ''}`)
    .join('\n');
  return `Stelle: ${job.title}
Firma: ${job.company}${job.location ? `, ${job.location}` : ''}
Stellenbeschreibung:
${desc}

Bewerber-Profil:
Ausbildung: ${profile.quereinstieg.abschluss}
Skills: ${alleSkills}
Sprachen: ${profile.sprachkenntnisse.join(', ')}
Projekte/Erfahrung:
${projekteText}
Hintergrund: ${profile.quereinstieg.hintergrund}

Struktur (3 Absätze, ≤180 Wörter gesamt):
Absatz 1 (~50 Wörter) — Anker: konkrete Rolle + Firma + EIN spezifisches Element aus der
  Stellenbeschreibung (Stack, Produkt oder Domäne). Dazu ein Satz, der auf dem Hintergrund
  aufbaut und ihn mit dieser Stelle verbindet — nicht "Als Quereinsteiger …". Aus dem Hintergrund
  GENAU EINEN Beleg (mit seiner Zahl) wählen, der zu dieser Stelle am besten passt, und den roten
  Faden in eigenen Worten daraus ziehen — nicht alle Belege aufzählen, nicht als Fähigkeit behaupten
  ("besitze die Fähigkeit …"), sondern das Erlebte erzählen. Kein "Hiermit bewerbe ich mich".
  NICHT: "Ob beim Spachteln von 2.000 m² oder der Verwaltung von 500 Klienten – ich zerlege Aufgaben."
  SO: "Auf der Baustelle habe ich an einem Tag 2.000 m² gespachtelt – nicht, weil die Fläche klein
  war, sondern weil ich mein Handwerk kannte. Genau so sehe ich Softwareentwicklung."
Absatz 2 (~70 Wörter) — Beleg: die 2 stärksten Überschneidungen zwischen Stellenanforderungen
  und Profil. Jeder genannte Skill braucht einen Beleg — ein konkretes Projekt aus dem Profil,
  keine nackte Aufzählung. Stehen oben mehrere Projekte im Profil: die 2 Belege aus 2
  verschiedenen Projekten nehmen, nicht zweimal dasselbe Projekt. Fehlt ein geforderter Skill
  im Profil: nächstliegende echte Erfahrung nennen und die Nähe benennen, nie den geforderten
  Skill selbst behaupten.
Absatz 3 (~50 Wörter) — Ausblick statt Floskel-Abschluss: keine "warum ich passe"-Aussage.
  Stattdessen eine konkrete Aufgabe aus den Anforderungen/Verantwortlichkeiten der Stelle
  aufgreifen, an der der Bewerber mitarbeiten will. Optional ein Satz ehrliche Junior-Haltung
  ohne Floskel ("motiviert", "engagiert" etc. vermeiden).`;
}

export function parseAnschreibenResponse(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 50) return null;
  if (trimmed.includes('[') || trimmed.includes(']')) {
    console.warn('[anschreiben] Platzhalter nicht ersetzt:', trimmed.slice(0, 100));
    return null;
  }
  if (trimmed.includes('Sehr geehrte')) {
    console.warn('[anschreiben] Floskel gefunden: "Sehr geehrte"');
    return null;
  }
  if (trimmed.includes('Mit freundlichen')) {
    console.warn('[anschreiben] Grußformel gefunden: "Mit freundlichen"');
    return null;
  }

  let absaetze = trimmed.split(/\n\s*\n/).filter(p => p.trim());
  // gemma trennt die Absätze gelegentlich nur mit einem einfachen Zeilenumbruch statt
  // einer Leerzeile — drei Zeilen sind dann trotzdem drei Absätze, kein Grund für
  // einen ~30 s teuren Neuversuch. Ein einziger Block ohne Umbruch bleibt ein Fehler.
  const zeilen = trimmed.split('\n').filter(z => z.trim());
  if (absaetze.length !== 3 && zeilen.length === 3) absaetze = zeilen;
  if (absaetze.length !== 3) {
    throw new Error(`Absatz-Anzahl ist ${absaetze.length}, erwartet 3 (${zeilen.length} Zeilen)`);
  }
  const text = absaetze.map(p => p.trim()).join('\n\n');

  const verbotswort = /\b(motiviert|begeistert|entzückt|leidenschaftlich)\b/i.exec(text);
  if (verbotswort) {
    throw new Error(`Verbotswort gefunden: "${verbotswort[0]}"`);
  }

  return text;
}

export const ANSCHREIBEN_LOG_PATH = 'data/anschreiben/AnschreibenLog.md';

function logSkip(job: Job, reason: string, logPath: string): void {
  const ts = logTimestamp();
  appendFileSync(logPath, `\n- Anschreiben-Skip ${ts}: ${job.title} — ${job.company} — Grund: ${reason}\n`);
}

function logSuccess(job: Job, model: string, path: string, logPath: string): void {
  const ts = logTimestamp();
  appendFileSync(logPath, `\n- Anschreiben-OK ${ts}: ${job.title} — ${job.company} — Modell: ${model} — ${path}\n`);
}

export async function saveAnschreiben(job: Job, text: string, dir = config.anschreibenDir): Promise<string> {
  await mkdir(dir, { recursive: true });
  // anschreibenZiel() räumt dabei eine Datei weg, die denselben Job unter einem
  // alten Namen meint — siehe lib/anschreiben-datei.ts.
  const path = await anschreibenZiel(job, dir);
  await writeFile(path, text, 'utf8');
  return path;
}

const MAX_REGENERATIONS = 2;
// Für die Anzeige "Versuch x von y" in der UI.
export const ANSCHREIBEN_MAX_VERSUCHE = MAX_REGENERATIONS + 1;

// Ein Timeout pro Versuch (Index = attempt), gekoppelt an MAX_REGENERATIONS+1 Versuche
// insgesamt: der letzte Versuch bekommt mehr Zeit, bevor endgültig übersprungen wird.
// Threads stehen im llama.cpp-Preset, nicht hier.
const TIMEOUTS_MS = [600_000, 600_000, 1_000_000];

export interface GenerateAnschreibenOptions {
  // Basis-URL des LLM-Backends; ungesetzt → Default des aktiven Providers.
  host?: string;
  anschreibenDir?: string;
  model?: string;
  logPath?: string;
  signal?: AbortSignal;
  // Meldet den Beginn jedes Versuchs (1-basiert) — der Runner zählt damit die
  // Versuche pro Brief für die Lauf-Anzeige.
  onAttempt?: (versuch: number) => void;
}

export async function generateAnschreiben(
  job: Job,
  storage: Storage,
  profile: ProfileData,
  options: GenerateAnschreibenOptions = {},
): Promise<string | null> {
  const {
    host,
    anschreibenDir,
    model,
    logPath = ANSCHREIBEN_LOG_PATH,
    signal,
    onAttempt,
  } = options;

  if (!canGenerateAnschreiben(job)) {
    console.warn(`[anschreiben] job ${job.id} hat status "${job.status}"/fit "${job.fit}", erwartet "triaged" mit fit "matched" oder "offstack"`);
    return null;
  }

  const { inference } = loadSettings();
  const llm = getProvider();
  const writerModel = model ?? llm.resolveModels().writer;
  let result: string | null = null;
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
    if (signal?.aborted) { lastError = 'Abgebrochen'; break; }
    onAttempt?.(attempt + 1);
    const timeoutMs = TIMEOUTS_MS[attempt];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let raw = '';
    try {
      // stream: true, damit der Server sofort HTTP-Header schickt statt erst nach voller
      // Generierung — sonst reißt undicis headersTimeout bei langsamen/großen Modellen
      // (z.B. Reasoning-Modelle mit verstecktem "thinking"-Anteil vor dem Content).
      // Timeout- und Stop-Button-Abbruch sind zwei unabhängige Gründe, denselben Call
      // abzubrechen — AbortSignal.any() bündelt sie zu einem Signal für chat().
      raw = await llm.chat({
        host,
        model: writerModel,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildAnschreibenPrompt(job, profile) },
        ],
        stream: true,
        think: inference.think,
        temperature: inference.writerTemperature,
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      });
    } catch (err) {
      lastError = err instanceof Error && err.name === 'AbortError'
        ? (signal?.aborted ? 'Abgebrochen' : `Timeout nach ${timeoutMs / 1000}s`)
        : err instanceof Error ? err.message : String(err);
      console.warn(`[anschreiben] Netzwerk-Fehler für job ${job.id} (Versuch ${attempt + 1}/${MAX_REGENERATIONS + 1}): ${lastError}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    try {
      result = parseAnschreibenResponse(raw);
      if (!result) {
        console.warn(`[anschreiben] Parse-Fehler bei ${job.id}`);
        return null;
      }
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      const label = attempt === 0 ? 'Versuch 1 fehlgeschlagen' : `Regenerierung ${attempt}/${MAX_REGENERATIONS}`;
      console.warn(`[anschreiben] ${label} für ${job.id}: ${lastError}`);
    }
  }

  if (!result) {
    logSkip(job, lastError, logPath);
    return null;
  }

  const path = await saveAnschreiben(job, result, anschreibenDir);
  // storage.update() statt storage.save(job): die Generierung oben dauert
  // 3-4 Minuten (siehe README, Performance) — ein weites Zeitfenster, in dem ein
  // Browser-Edit (z.B. fit ändern) am selben Job passieren kann. update() merged
  // nur `status` auf den AKTUELLEN Diskstand statt diesen ganzen, potenziell
  // veralteten `job` zu überschreiben (gleiches Muster wie lib/filter.ts).
  await storage.update(job.id, { status: 'generated' });
  logSuccess(job, writerModel, path, logPath);
  return path;
}
