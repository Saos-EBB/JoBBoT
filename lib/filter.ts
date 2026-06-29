import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { config } from '../config.ts';

const SYSTEM = `Du bist ein Jobsuche-Assistent. Entscheide ob eine Stellenanzeige für einen Junior-Entwickler oder Berufseinsteiger geeignet ist.
Antworte NUR mit einem JSON-Objekt, sonst nichts: {"match": true|false, "reason": "kurze Begründung (max 20 Wörter)"}`;

export function buildFilterPrompt(job: Job): string {
  const desc = job.description.slice(0, 800);
  return `Titel: ${job.title}
Firma: ${job.company}
${desc ? `Beschreibung: ${desc}\n` : ''}
Ist das eine Junior/Einsteiger-Stelle? Antworte mit JSON: {"match": true|false, "reason": "..."}
Ausschlusskriterien: Senior/Lead/Principal im Titel, >3 Jahre Erfahrung gefordert, keine Firma (Headhunter-Spam), falsches Fachgebiet.`;
}

export function parseFilterResponse(raw: string): { match: boolean; reason: string } | null {
  try {
    const obj = JSON.parse(raw.trim()) as { match?: unknown; reason?: unknown };
    if (typeof obj.match !== 'boolean' || typeof obj.reason !== 'string') return null;
    return { match: obj.match, reason: obj.reason };
  } catch {
    return null;
  }
}

export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost): Promise<void> {
  let raw = '';
  try {
    const res = await fetch(`${ollama}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelFilter,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildFilterPrompt(job) },
        ],
        stream: false,
      }),
    });
    if (!res.ok) {
      console.warn(`[filter] ollama ${res.status} für job ${job.id}`);
      return;
    }
    const data = await res.json() as { message?: { content?: string } };
    raw = data?.message?.content ?? '';
  } catch (err) {
    console.warn(`[filter] netzwerk-fehler für job ${job.id}:`, err);
    return;
  }

  const parsed = parseFilterResponse(raw);
  if (!parsed) {
    console.warn(`[filter] kein valides JSON für job ${job.id}: ${raw.slice(0, 100)}`);
    return;
  }

  job.status = parsed.match ? 'matched' : 'filtered_out';
  job.match = { ok: parsed.match, reason: parsed.reason };
  job.updatedAt = new Date().toISOString();
  await storage.save(job);
}
