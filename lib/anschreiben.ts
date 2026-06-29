import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { jobBasename } from './slugify.ts';
import { config } from '../config.ts';

const SYSTEM = `Du bist ein Karriereberater der hilft, überzeugende aber authentische Bewerbungsanschreiben zu schreiben.`;

export function buildAnschreibenPrompt(job: Job): string {
  const desc = job.description.slice(0, 1200);
  return `Stelle: ${job.title}
Firma: ${job.company}${job.location ? `\nOrt: ${job.location}` : ''}
${desc ? `\nStellenbeschreibung:\n${desc}\n` : ''}
Schreib ein deutsches Bewerbungsanschreiben für einen Junior-Bewerber.
Ton: professionell aber nicht steif, keine Floskeln wie "hiermit bewerbe ich mich", kein "Mit freundlichen Grüßen" am Ende.
Länge: 3 kurze Absätze, max 200 Wörter gesamt.
Antworte NUR mit dem Anschreiben als Plaintext, kein JSON, keine Erklärungen, keine Markdown-Formatierung, kein Betreff.`;
}

export function parseAnschreibenResponse(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length >= 50 ? trimmed : null;
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
  ollama = config.ollamaHost,
  anschreibenDir?: string,
): Promise<string | null> {
  if (job.status !== 'matched') {
    console.warn(`[anschreiben] job ${job.id} hat status "${job.status}", erwartet "matched"`);
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
          { role: 'user', content: buildAnschreibenPrompt(job) },
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
