import { mkdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import type { ProfileData } from './profile.ts';
import { jobBasename } from './slugify.ts';
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
- Fordert die Stelle einen Skill, der im Profil fehlt: die Lücke offen benennen — seit wann mit dem
  verwandten Stack gearbeitet wird und die Lernbereitschaft dafür — NIE die Nähe als vorhandene
  Kompetenz verkaufen oder den geforderten Skill selbst behaupten.
- Kein Skill ohne Beleg: jede genannte Fähigkeit braucht ein konkretes Projekt/Kontext aus dem Profil,
  nie eine nackte Aufzählung.
- Stehen mehrere Projekte im Profil: nicht zweimal dasselbe Projekt als Beleg nutzen. Jedes
  im Profil gelistete Projekt darf höchstens einmal vorkommen.
- Keine vorgegebenen Satzanfänge — der Einstieg muss von Job zu Job variieren.`;

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
  Stellenbeschreibung (Stack, Produkt oder Domäne). Dazu ein Satz, wer der Bewerber ist
  (Quereinsteiger in die Softwareentwicklung). Kein "Hiermit bewerbe ich mich".
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

  const absaetze = trimmed.split(/\n\s*\n/).filter(p => p.trim());
  if (absaetze.length !== 3) {
    throw new Error(`Absatz-Anzahl ist ${absaetze.length}, erwartet 3`);
  }

  const verbotswort = /\b(motiviert|begeistert|entzückt|leidenschaftlich)\b/i.exec(trimmed);
  if (verbotswort) {
    throw new Error(`Verbotswort gefunden: "${verbotswort[0]}"`);
  }

  return trimmed;
}

export const ANSCHREIBEN_LOG_PATH = 'data/anschreiben/AnschreibenLog.md';

function logSkip(job: Job, reason: string, logPath: string): void {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  appendFileSync(logPath, `\n- Anschreiben-Skip ${ts}: ${job.title} — ${job.company} — Grund: ${reason}\n`);
}

function logSuccess(job: Job, model: string, path: string, logPath: string): void {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  appendFileSync(logPath, `\n- Anschreiben-OK ${ts}: ${job.title} — ${job.company} — Modell: ${model} — ${path}\n`);
}

export async function saveAnschreiben(job: Job, text: string, dir = config.anschreibenDir): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${jobBasename(job)}.md`);
  await writeFile(path, text, 'utf8');
  return path;
}

// Ollama streamt bei stream:true NDJSON (ein JSON-Objekt pro Zeile). Konkateniert
// die message.content-Fragmente zum vollständigen Text.
export async function readNdjsonContent(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const chunk = JSON.parse(trimmed) as { message?: { content?: string } };
    content += chunk?.message?.content ?? '';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      consumeLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) consumeLine(buffer);

  return content;
}

const MAX_REGENERATIONS = 2;

// Ein Eintrag pro Versuch (Index = attempt), gekoppelt an MAX_REGENERATIONS+1 Versuche
// insgesamt: die ersten beiden Versuche mit voller Thread-Zahl und knapperem Timeout,
// der letzte Versuch mit weniger Threads (mehr Luft für den Rest vom System) und
// entsprechend mehr Zeit, bevor endgültig übersprungen wird.
const RETRY_CONFIG = [
  { numThread: 6, timeoutMs: 600_000 },
  { numThread: 6, timeoutMs: 600_000 },
  { numThread: 4, timeoutMs: 1_000_000 },
];

export async function generateAnschreiben(
  job: Job,
  storage: Storage,
  profile: ProfileData,
  ollama = config.ollamaHost,
  anschreibenDir?: string,
  model = config.modelWriter,
  logPath = ANSCHREIBEN_LOG_PATH,
  signal?: AbortSignal,
): Promise<string | null> {
  if (job.status !== 'triaged' || job.fit === 'brutal') {
    console.warn(`[anschreiben] job ${job.id} hat status "${job.status}"/fit "${job.fit}", erwartet "triaged" mit fit "matched" oder "offstack"`);
    return null;
  }

  let result: string | null = null;
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
    if (signal?.aborted) { lastError = 'Abgebrochen'; break; }
    const { numThread, timeoutMs } = RETRY_CONFIG[attempt];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let raw = '';
    try {
      // stream: true, damit Ollama sofort HTTP-Header schickt statt erst nach voller
      // Generierung — sonst reißt undicis headersTimeout bei langsamen/großen Modellen
      // (z.B. Reasoning-Modelle mit verstecktem "thinking"-Anteil vor dem Content).
      const res = await fetch(`${ollama}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Timeout- und Stop-Button-Abbruch sind zwei unabhängige Gründe, denselben
        // Fetch abzubrechen — AbortSignal.any() statt eines zusätzlichen Listeners,
        // der den controller manuell abort()en müsste.
        signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: buildAnschreibenPrompt(job, profile) },
          ],
          stream: true,
          options: { num_thread: numThread },
        }),
      });
      if (!res.ok) {
        console.warn(`[anschreiben] ollama ${res.status} für job ${job.id}`);
        return null;
      }
      raw = await readNdjsonContent(res);
    } catch (err) {
      lastError = err instanceof Error && err.name === 'AbortError'
        ? (signal?.aborted ? 'Abgebrochen' : `Timeout nach ${timeoutMs / 1000}s (${numThread} Threads)`)
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
  logSuccess(job, model, path, logPath);
  return path;
}
