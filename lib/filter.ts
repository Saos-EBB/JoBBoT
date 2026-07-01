import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { config } from '../config.ts';
import { checkTitle } from './title-filter.ts';

export const SYSTEM = `Du bewertest, ob eine Stellenanzeige für einen IT-BERUFSEINSTEIGER passt.
Der Bewerber ist Junior-Softwareentwickler, offen für die gesamte Einsteiger-IT.

PASST (match: true):
- Software-/App-/Web-Entwicklung, EGAL welche Sprache/Framework (Java, C#, Python, JavaScript, SAP, egal — Hauptsache Entwicklung).
- 2nd-Level-Support / Application Support (mit echter technischer Fehleranalyse, nicht nur Weiterleitung).
- Junior/Einsteiger System- oder Netzwerk-Administration.
- QA / Software-Testing (auch manuell, nicht nur automatisiert).
- Lehrstelle NUR wenn coding-nah: Applikationsentwicklung / Coding / Softwareentwicklung.
- Neutraler Titel ("Softwareentwickler" ohne Junior/Senior): PASST, WENN die Beschreibung KEINE mehrjährige Erfahrung / kein Senior-Niveau verlangt (kein ">3 Jahre", kein "mehrjährige/fundierte Erfahrung", kein "Expert").
- Rolle, die 1st UND 2nd Level kombiniert: PASST (der 2nd-Level-Anteil zählt).

PASST NICHT (match: false):
- Reiner 1st-Level-Support / Helpdesk (Anrufannahme, Ticket-Weiterleitung, Passwort-Resets, keine tiefere technische Analyse).
- Senior / Lead / Principal, ODER Beschreibung fordert mehrjährige Berufserfahrung.
- Lehrstelle, die NICHT coding-nah ist (Systemtechnik, Netzwerktechnik, Hardware, IT-Kaufmann) → raus.
- Keine IT-Kernrolle: Vertrieb, reines Projektmanagement/Consulting ohne Technik, Elektrotechnik/Hardware-Bau, reine Datenerfassung.

Bei Unsicherheit über das Level: entscheide anhand der geforderten Berufsjahre in der Beschreibung.

Grenzfälle zur Orientierung:
- "Junior Java Developer" → true ("Einsteiger-Dev-Rolle")
- Reiner 1st-Level-Helpdesk (nur Anrufannahme, Weiterleitung) → false ("reiner 1st-Level")
- 2nd-Level / Application Support mit Fehleranalyse → true ("2nd-Level-Support")
- "Lehre Applikationsentwicklung" → true ("coding-nahe Lehre")
- "Lehre/Lehrling IT-Systemtechnik" → false ("Lehre nicht coding-nah")

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

// Kein Few-Shot als eigene Chat-Turns: bei qwen2.5:3b + temperature 0 papageit das
// Modell das nächstgelegene Few-Shot-Beispiel statt den tatsächlichen Job zu bewerten
// (reproduziert — gleiche reason wortidentisch mit dem Beispiel, unabhängig vom Input).
// Grenzfälle (2nd-Level, coding-nahe Lehre, ...) stehen stattdessen als Beispieltext
// im SYSTEM-Prompt selbst — reiner System-Prompt + format:json klassifiziert zuverlässig.
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
