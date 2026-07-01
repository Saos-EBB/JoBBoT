import type { Job } from '../scrapers/interface.ts';
import { checkTitle, isLehre } from './title-filter.ts';
import { buildStageInput } from './job-text.ts';
import { askClearYesNo } from './filter-llm.ts';
import type { Verdict } from './filter-llm.ts';
import { config } from '../config.ts';

export type StageOutcome = 'reject' | 'unsure' | 'pass';

export interface StageLog {
  stage: string;
  verdict: Verdict | 'keyword';
  outcome: StageOutcome;
}

export interface CascadeResult {
  status: 'matched' | 'uncertain' | 'filtered_out';
  stages: StageLog[];
  rejectedBy?: string;
}

export type Ask = (question: string, jobInput: string) => Promise<Verdict>;

export interface CascadeOptions {
  ask?: Ask;
  ollama?: string;
}

function outcomeFor(verdict: Verdict, rejectOn: 'ja' | 'nein'): StageOutcome {
  if (verdict === 'unsicher') return 'unsure';
  return verdict === rejectOn ? 'reject' : 'pass';
}

// Kurzschluss: erstes "reject" stoppt die Kette sofort (spart Ollama-Calls und
// ist deterministisch nachvollziehbar — jede Stufe ist ein sauberer Schnitt statt
// eine einzelne, überladene Frage, die das 3b-Modell zum Papageien brachte.
export async function runCascade(job: Job, options: CascadeOptions = {}): Promise<CascadeResult> {
  const ollama = options.ollama ?? config.ollamaHost;
  const ask: Ask = options.ask ?? ((question, jobInput) => askClearYesNo(question, jobInput, ollama));
  const stages: StageLog[] = [];

  const titleVerdict = checkTitle(job.title);
  stages.push({ stage: 'Seniorität (Titel)', verdict: 'keyword', outcome: titleVerdict.excluded ? 'reject' : 'pass' });
  if (titleVerdict.excluded) {
    return { status: 'filtered_out', stages, rejectedBy: 'Seniorität (Titel)' };
  }

  const input = buildStageInput(job);

  const itVerdict = await ask(
    'Ist das eine Rolle in der IT/Softwarebranche (Entwicklung, Support, Administration, QA, Netzwerk, Daten)?',
    input,
  );
  const itOutcome = outcomeFor(itVerdict, 'nein');
  stages.push({ stage: 'IT-Rolle', verdict: itVerdict, outcome: itOutcome });
  if (itOutcome === 'reject') return { status: 'filtered_out', stages, rejectedBy: 'IT-Rolle' };

  const expVerdict = await ask(
    'Verlangt diese Stelle mehrjährige Berufserfahrung oder ein Senior-Niveau?',
    input,
  );
  const expOutcome = outcomeFor(expVerdict, 'ja');
  stages.push({ stage: 'Erfahrung', verdict: expVerdict, outcome: expOutcome });
  if (expOutcome === 'reject') return { status: 'filtered_out', stages, rejectedBy: 'Erfahrung' };

  if (isLehre(job.title)) {
    const lehreVerdict = await ask(
      'Ist diese Lehrstelle auf Programmieren bzw. Applikationsentwicklung ausgerichtet (nicht Systemtechnik, Netzwerktechnik oder Hardware)?',
      input,
    );
    const lehreOutcome = outcomeFor(lehreVerdict, 'nein');
    stages.push({ stage: 'Lehre-Ausrichtung', verdict: lehreVerdict, outcome: lehreOutcome });
    if (lehreOutcome === 'reject') return { status: 'filtered_out', stages, rejectedBy: 'Lehre-Ausrichtung' };
  }

  const status = stages.some(s => s.outcome === 'unsure') ? 'uncertain' : 'matched';
  return { status, stages };
}
