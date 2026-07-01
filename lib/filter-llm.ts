import { config } from '../config.ts';

export type Verdict = 'ja' | 'nein' | 'unsicher';

export const STAGE_SYSTEM = `Du beantwortest EINE einzige Ja/Nein-Frage über eine Stellenanzeige.
Antworte "ja" oder "nein" NUR, wenn die Anzeige das EINDEUTIG hergibt.
Beim kleinsten Zweifel antworte "unsicher".
Antworte NUR mit JSON: {"antwort": "ja" | "nein" | "unsicher"}`;

export function parseVerdict(raw: string): Verdict | null {
  try {
    const obj = JSON.parse(raw.trim()) as { antwort?: unknown };
    if (obj.antwort === 'ja' || obj.antwort === 'nein' || obj.antwort === 'unsicher') return obj.antwort;
    return null;
  } catch {
    return null;
  }
}

async function attempt(question: string, jobInput: string, ollama: string): Promise<Verdict | null> {
  try {
    const res = await fetch(`${ollama}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelFilter,
        messages: [
          { role: 'system', content: STAGE_SYSTEM },
          { role: 'user', content: `${question}\n\n${jobInput}` },
        ],
        format: 'json',
        options: { temperature: 0 },
        stream: false,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { message?: { content?: string } };
    return parseVerdict(data?.message?.content ?? '');
  } catch {
    return null;
  }
}

// Recall-sicher: JEDER Fehlerfall (Netzwerk, HTTP, Parse — auch nach Retry)
// landet bei "unsicher", NIE bei einem harten "nein". Ein Job darf durch
// einen Ollama-Hänger nicht verloren gehen, nur ins Review-Fach rutschen.
export async function askClearYesNo(question: string, jobInput: string, ollama = config.ollamaHost): Promise<Verdict> {
  const first = await attempt(question, jobInput, ollama);
  if (first) return first;
  const retry = await attempt(question, jobInput, ollama);
  return retry ?? 'unsicher';
}
