import { mkdir, writeFile } from 'node:fs/promises';
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
- Antwort enthält NUR den Anschreiben-Text, absolut nichts sonst`;

export function buildAnschreibenPrompt(job: Job, profile: ProfileData): string {
  const desc = job.description.slice(0, 1200);
  const alleSkills = [
    ...profile.programming_languages,
    ...profile.frontend,
    ...profile.backend,
    ...profile.databases,
  ].join(', ');
  const projekteText = profile.projekte
    .slice(0, 2)
    .map(p => `${p.name}: ${p.beschreibung}`)
    .join('\n');
  return `Stelle: ${job.title}
Firma: ${job.company}${job.location ? `, ${job.location}` : ''}
Stellenbeschreibung:
${desc}

Bewerber-Profil:
Ausbildung: ${profile.ausbildung.abschluss}
Skills: ${alleSkills}
Sprachen: ${profile.sprachen.join(', ')}
Projekte/Erfahrung:
${projekteText}
Über mich: ${profile.ueber_mich}

Struktur:
Absatz 1: Warum genau diese Stelle bei genau dieser Firma — konkret und spezifisch, nicht generisch.
Absatz 2: Was der Bewerber konkret mitbringt — passend zu den Anforderungen der Stelle.
Absatz 3: Kurzer, direkter Abschluss mit Gesprächswunsch.`;
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
  return trimmed;
}

export async function saveAnschreiben(job: Job, text: string, dir = config.anschreibenDir): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${jobBasename(job)}.md`);
  await writeFile(path, text, 'utf8');
  return path;
}

export async function generateAnschreiben(
  job: Job,
  storage: Storage,
  profile: ProfileData,
  ollama = config.ollamaHost,
  anschreibenDir?: string,
): Promise<string | null> {
  if (job.status !== 'matched' && job.status !== 'uncertain') {
    console.warn(`[anschreiben] job ${job.id} hat status "${job.status}", erwartet "matched" oder "uncertain"`);
    return null;
  }

  let raw = '';
  try {
    const res = await fetch(`${ollama}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelWriter,
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

  const result = parseAnschreibenResponse(raw);
  if (!result) {
    console.warn(`[anschreiben] Parse-Fehler bei ${job.id}`);
    return null;
  }

  const path = await saveAnschreiben(job, result, anschreibenDir);
  job.status = 'generated';
  job.updatedAt = new Date().toISOString();
  await storage.save(job);
  return path;
}
