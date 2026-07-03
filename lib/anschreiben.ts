import { mkdir, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import type { ProfileData } from './profile.ts';
import { jobBasename } from './slugify.ts';
import { config } from '../config.ts';

const SYSTEM = `Du bist ein erfahrener Karriereberater. Du schreibst präzise, authentische Bewerbungsanschreiben auf Deutsch.
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
- Fordert die Stelle einen Skill, der im Profil fehlt: nächstliegende echte Erfahrung nennen und
  die Nähe ehrlich benennen (z.B. "konzeptuell nah an X") — NIE den geforderten Skill selbst behaupten.
- Kein Skill ohne Beleg: jede genannte Fähigkeit braucht ein konkretes Projekt/Kontext aus dem Profil,
  nie eine nackte Aufzählung.
- Keine vorgegebenen Satzanfänge — der Einstieg muss von Job zu Job variieren.`;

export function buildAnschreibenPrompt(job: Job, profile: ProfileData): string {
  const desc = job.description.slice(0, 1200);
  const alleSkills = [
    ...profile.skills.sprachen,
    ...profile.skills.frontend,
    ...profile.skills.backend,
    ...profile.skills.datenbanken,
  ].join(', ');
  const projekteText = profile.projekte
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
  keine nackte Aufzählung. Fehlt ein geforderter Skill im Profil: nächstliegende echte Erfahrung
  nennen und die Nähe benennen, nie den geforderten Skill selbst behaupten.
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

function logSkip(job: Job, reason: string, logPath: string): void {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  appendFileSync(logPath, `\n- Anschreiben-Skip ${ts}: ${job.title} — ${job.company} — Grund: ${reason}\n`);
}

export async function saveAnschreiben(job: Job, text: string, dir = config.anschreibenDir): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${jobBasename(job)}.md`);
  await writeFile(path, text, 'utf8');
  return path;
}

const MAX_REGENERATIONS = 2;

export async function generateAnschreiben(
  job: Job,
  storage: Storage,
  profile: ProfileData,
  ollama = config.ollamaHost,
  anschreibenDir?: string,
  model = config.modelWriter,
  logPath = 'data/filter-log.md',
): Promise<string | null> {
  if (job.status !== 'matched' && job.status !== 'uncertain') {
    console.warn(`[anschreiben] job ${job.id} hat status "${job.status}", erwartet "matched" oder "uncertain"`);
    return null;
  }

  let result: string | null = null;
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_REGENERATIONS; attempt++) {
    let raw = '';
    try {
      const res = await fetch(`${ollama}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: buildAnschreibenPrompt(job, profile) },
          ],
          stream: false,
        }),
      });
      if (!res.ok) {
        console.warn(`[anschreiben] ollama ${res.status} für job ${job.id}`);
        return null;
      }
      const data = await res.json() as { message?: { content?: string } };
      raw = data?.message?.content ?? '';
    } catch (err) {
      console.warn(`[anschreiben] netzwerk-fehler für job ${job.id}:`, err);
      return null;
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
  job.status = 'generated';
  job.updatedAt = new Date().toISOString();
  await storage.save(job);
  return path;
}
