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

// Zwei Beispiele als user/assistant-Paare, damit das 3b-Modell Format und Logik stabil hält.
const FEWSHOT: { role: 'user' | 'assistant'; content: string }[] = [
  {
    role: 'user',
    content: 'Titel: Junior Frontend Developer\nFirma: TechCorp GmbH\nOrt: Linz\nBeschreibung: Wir suchen eine:n Junior Frontend Developer zur Verstärkung unseres Teams. Du arbeitest mit React und TypeScript. Erste Erfahrung von Vorteil, kein Muss. Wir bieten Einschulung und Mentoring.',
  },
  { role: 'assistant', content: '{"match": true, "reason": "Klare Junior-Entwicklerrolle, keine Erfahrung vorausgesetzt"}' },
  {
    role: 'user',
    content: 'Titel: IT-Systemtechniker (m/w/d)\nFirma: Musterfirma GmbH\nOrt: Wels\nBeschreibung: Betreuung und Wartung unserer IT-Infrastruktur, Serveradministration, Netzwerkbetreuung, Support für Mitarbeiter:innen bei Hard- und Softwareproblemen vor Ort.',
  },
  { role: 'assistant', content: '{"match": false, "reason": "IT-Support/Systemtechnik, keine Entwicklerrolle"}' },
];

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

export function buildMessages(job: Job): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  return [
    { role: 'system', content: SYSTEM },
    ...FEWSHOT,
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

export async function filterJob(job: Job, storage: Storage, ollama = config.ollamaHost): Promise<FilterDecision> {
  let raw = '';
  try {
    const res = await fetch(`${ollama}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelFilter,
        messages: buildMessages(job),
        stream: false,
      }),
    });
    if (!res.ok) {
      return { job, outcome: 'skipped', reason: `Ollama HTTP ${res.status}`, source: 'llm' };
    }
    const data = await res.json() as { message?: { content?: string } };
    raw = data?.message?.content ?? '';
  } catch (err) {
    return { job, outcome: 'skipped', reason: `Netzwerkfehler: ${String(err)}`, source: 'llm' };
  }

  const parsed = parseFilterResponse(raw);
  if (!parsed) {
    return { job, outcome: 'skipped', reason: 'LLM-Antwort nicht parsebar', source: 'llm' };
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
