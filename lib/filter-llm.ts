import { config } from '../config.ts';

export type Tri = 'ja' | 'nein' | 'unsicher';

export interface FilterJudgment {
  it_rolle: Tri;
  erfahrung_ab_3j_erforderlich: Tri;
  lehre_coding: Tri | 'n/a';
  junior_signal: 'ja' | 'nein';
}

const SYSTEM = `Du bewertest EINE Stellenanzeige für einen IT-Berufseinsteiger und gibst
für vier Kriterien ein Urteil ab. Antworte NUR mit JSON, exakt diese Keys:
{
"it_rolle": "...",
"erfahrung_ab_3j_erforderlich": "...",
"lehre_coding": "...",
"junior_signal": "..."
}
"it_rolle": Ist das eine IT/Tech-Rolle?
"erfahrung_ab_3j_erforderlich": Fordert der Text AUSDRÜCKLICH mind. 3 Jahre bzw.
mehrjährige Berufserfahrung als VORAUSSETZUNG? "von Vorteil/erwünscht" zählt NICHT.
1-2 Jahre zählt NICHT.
"lehre_coding": Nur bei Lehrstelle: coding-/Applikationsentwicklungs-nah? Sonst "n/a".
"junior_signal": Sagt der Text AUSDRÜCKLICH Junior/Einsteiger/Absolvent/Trainee/Lehre?
Werte "it_rolle", "erfahrung_ab_3j_erforderlich", "lehre_coding" nutzen "ja"/"nein"/"unsicher".
Bei echtem Zweifel "unsicher" — rate nicht.
"junior_signal" nur "ja"/"nein".`;

function isTri(v: unknown): v is Tri {
  return v === 'ja' || v === 'nein' || v === 'unsicher';
}

export function parseJudgment(raw: string): FilterJudgment | null {
  try {
    const obj = JSON.parse(raw.trim()) as Record<string, unknown>;
    if (!isTri(obj.it_rolle)) return null;
    if (!isTri(obj.erfahrung_ab_3j_erforderlich)) return null;
    if (!isTri(obj.lehre_coding) && obj.lehre_coding !== 'n/a') return null;
    if (obj.junior_signal !== 'ja' && obj.junior_signal !== 'nein') return null;
    return {
      it_rolle: obj.it_rolle,
      erfahrung_ab_3j_erforderlich: obj.erfahrung_ab_3j_erforderlich,
      lehre_coding: obj.lehre_coding as Tri | 'n/a',
      junior_signal: obj.junior_signal,
    };
  } catch {
    return null;
  }
}

async function attempt(jobInput: string, isLehre: boolean, ollama: string): Promise<FilterJudgment | null> {
  try {
    const res = await fetch(`${ollama}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelWriter,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: (isLehre ? 'Dies ist eine Lehrstelle.\n' : '') + jobInput },
        ],
        format: 'json',
        options: { temperature: 0 },
        stream: false,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { message?: { content?: string } };
    return parseJudgment(data?.message?.content ?? '');
  } catch {
    return null;
  }
}

// Recall-sicher: 2. Parse-/Netzwerkfehler in Folge → null statt Absturz.
// filter-decide.ts mappt null auf status "uncertain", NIE auf "filtered_out" —
// ein Ollama-Hänger darf einen Job nicht kosten, nur ins Review-Fach schieben.
export async function judgeJob(jobInput: string, isLehre: boolean, ollama = config.ollamaHost): Promise<FilterJudgment | null> {
  const first = await attempt(jobInput, isLehre, ollama);
  if (first) return first;
  return attempt(jobInput, isLehre, ollama);
}
