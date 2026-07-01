import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { config } from '../config.ts';
import { checkTitle } from './title-filter.ts';

export const SYSTEM = `Du bewertest, ob eine Stellenanzeige für einen JUNIOR-SOFTWAREENTWICKLER passt.

PASST (match: true), wenn ALLE zutreffen:
- Es ist eine Rolle, in der man SELBST CODE SCHREIBT (Frontend, Backend, Fullstack, Software-, Web-, App-, Mobile-Entwicklung). Die GENAUE Programmiersprache/Framework ist EGAL (Java, C#, Python, JavaScript, SAP, egal — Hauptsache Entwicklung).
- Sie ist für Einsteiger geeignet: explizit Junior/Berufseinsteiger/Trainee, ODER die Beschreibung fordert KEINE mehrjährige Erfahrung (kein ">3 Jahre", kein "mehrjährige/fundierte Erfahrung", kein "Expert").

PASST NICHT (match: false), wenn EINES zutrifft:
- Keine Entwickler-Rolle: IT-Support/Helpdesk, System-/Netzwerk-Administration, Systemtechnik, Hardware/Elektrotechnik, reine Datenanalyse ohne Coding, Consultant/Berater, Projektleitung/Management, Vertrieb, Security-Governance ohne Coding.
- Die Beschreibung verlangt mehrjährige Berufserfahrung oder Senior-Niveau.

Wenn der Titel neutral ist ("Softwareentwickler" ohne Junior/Senior): ENTSCHEIDE ANHAND DER BESCHREIBUNG — geforderte Jahre/Erfahrung prüfen.

Antworte mit NUR diesem JSON, nichts davor/danach:
{"match": true oder false, "reason": "max 15 Wörter, deutsch"}`;

export interface FilterDecision {
  job: Job;
  outcome: 'matched' | 'filtered_out' | 'skipped';
  reason: string;
  source: 'title-rule' | 'llm';
  term?: string;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildFilterPrompt(job: Job): string {
  const desc = stripHtml(job.description).slice(0, 1000);
  return `Titel: ${job.title}
Firma: ${job.company}
Ort: ${job.location ?? ''}${desc ? `\nBeschreibung: ${desc}` : ''}`;
}

// Kein Few-Shot: bei qwen2.5:3b + temperature 0 papageit das Modell das nächstgelegene
// Few-Shot-Beispiel statt den tatsächlichen Job zu bewerten (reproduziert — gleiche
// reason wortidentisch mit dem Beispiel, unabhängig vom Input). Reiner System-Prompt
// + format:json klassifiziert zuverlässig.
export function buildMessages(job: Job): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildFilterPrompt(job) },
  ];
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

async function callOllama(job: Job, ollama: string): Promise<{ raw?: string; error?: string }> {
  try {
    const res = await fetch(`${ollama}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelFilter,
        messages: buildMessages(job),
        format: 'json',
        options: { temperature: 0 },
        stream: false,
      }),
    });
    if (!res.ok) return { error: `Ollama HTTP ${res.status}` };
    const data = await res.json() as { message?: { content?: string } };
    return { raw: data?.message?.content ?? '' };
  } catch (err) {
    return { error: `Netzwerkfehler: ${String(err)}` };
  }
}

export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost): Promise<FilterDecision> {
  const first = await callOllama(job, ollama);
  if (first.error) {
    return { job, outcome: 'skipped', reason: first.error, source: 'llm' };
  }

  let raw = first.raw ?? '';
  let parsed = parseFilterResponse(raw);

  if (!parsed) {
    const retry = await callOllama(job, ollama);
    if (retry.error) {
      return { job, outcome: 'skipped', reason: retry.error, source: 'llm' };
    }
    raw = retry.raw ?? '';
    parsed = parseFilterResponse(raw);
  }

  if (!parsed) {
    console.warn(`[filter] Parse-Fehler bei "${job.title}" nach Retry: ${raw.slice(0, 200)}`);
    return { job, outcome: 'skipped', reason: 'LLM-Antwort nicht parsebar (nach Retry)', source: 'llm' };
  }

  job.match = { ok: parsed.match, reason: parsed.reason };
  job.updatedAt = new Date().toISOString();

  if (parsed.match) {
    job.status = 'matched';
    await storage.save(job);
    return { job, outcome: 'matched', reason: parsed.reason, source: 'llm' };
  } else {
    job.status = 'filtered_out';
    await storage.delete(job.id);
    return { job, outcome: 'filtered_out', reason: parsed.reason, source: 'llm' };
  }
}

// Läuft dem LLM-Call vorweg: eindeutige Ausschlüsse (Senior, Lehre) spart den
// Ollama-Roundtrip und ist deterministisch statt vom 3b-Modell abhängig.
export async function decideJob(job: Job, storage: Storage, ollama = config.ollamaHost): Promise<FilterDecision> {
  const titleVerdict = checkTitle(job.title);
  if (titleVerdict.excluded) {
    const reason = `Titel-Ausschluss: '${titleVerdict.term}'`;
    job.match = { ok: false, reason };
    job.status = 'filtered_out';
    job.updatedAt = new Date().toISOString();
    await storage.delete(job.id);
    return { job, outcome: 'filtered_out', reason, source: 'title-rule', term: titleVerdict.term };
  }
  return filterJob(job, storage, ollama);
}
