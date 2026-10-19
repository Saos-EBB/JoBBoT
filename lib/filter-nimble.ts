import { askField, defaultAsk, primer } from './nimble-client.ts';
import type { Ask, Choice as NimbleChoice } from './nimble-client.ts';
import { stripHtml } from './job-text.ts';
import { mapJudgment } from './filter-judgment.ts';
import { loadExperienceRules } from './experience-regex.ts';
import type { ExperienceRules } from './experience-regex.ts';
import { loadSettings } from './settings.ts';
import type { FilterJudgment, Tri } from './filter-judgment.ts';
import type { FilterStrategy } from './filter-types.ts';
import type { Job } from '../scrapers/interface.ts';

// Filter mit Bespoke Nimble 9B (Preset [nimble-9b] / [nimble-9b-vulkan]): ein
// Klassifizierer, kein Chat-Modell. Pro Aufruf GENAU EIN Feld, Antwort ein Buchstabe.
// Ergebnis ist ein FilterJudgment, gemappt über mapJudgment() (lib/filter-judgment.ts).
//
// Jedes Feld bekommt nur den Textausschnitt, den es für die
// Entscheidung braucht — Prompt-Verarbeitung ist auf CPU/iGPU der ganze Zeitaufwand:
//   wanted_job        Titel + Anfang der Beschreibung (dort stehen die Aufgaben)
//   erfahrung_ab_3j   Titel + nur die Sätze, die Erfahrung/Jahre erwähnen;
//                     gibt es keinen solchen Satz → "nein" ohne Call
//   lehre_coding      nicht gefragt, immer "n/a": Lehrstellen in einem Wunschbereich sind
//                     gewollt, ob coding-nah oder nicht — das deckt wanted_job ab
//   junior_signal     kein Call: Stichwortsuche (juniorSignals aus experience-rules.json)
//
// wanted_job ist das Feld it_rolle des Judgments — die Frage ist nicht "IT ja/nein",
// sondern "Support, einer der Wunschjobs oder keins?" (config/settings.json:
// nimble.supportJobs / nimble.wantedJobs). Support wird nie wegen Erfahrung brutal.


const INTRO_CHARS = 400;
const SENTENCE_CHARS = 220;
const MAX_SENTENCES = 4;
// Mengenangabe zur Erfahrung: Zahl + Jahre oder ein Wort wie "mehrjährig".
const AMOUNT = /\d+\s*\+?\s*(?:[-–]\s*\d+\s*)?(?:jahr|years?)|mehrjährig|langjährig|several years/;

export type NimbleField = 'wanted_job' | 'erfahrung_ab_3j_erforderlich';

type Choice<L extends string = Tri> = NimbleChoice<L>;

const TRI: Choice[] = [
  { code: 'A', label: 'ja' },
  { code: 'B', label: 'nein' },
  { code: 'C', label: 'unsicher', description: 'Der Text gibt es nicht eindeutig her.' },
];

// EIN Schema mit beiden Feldern, für jeden Aufruf wortgleich: System + Schema sind damit
// ein fester Präfix, den llama-server über Kontext-Checkpoints aus dem Cache holt — pro
// Frage wird nur der kurze Kontext gerechnet. (Ein eigenes Schema pro Feld lief schon
// beim Feldnamen auseinander und warf den Cache bei jedem Wechsel weg.)
// wanted_job unterscheidet Support von den übrigen Wunschbereichen: Support wird nie
// wegen Berufserfahrung aussortiert (siehe createNimbleStrategy).
export type Wanted = 'support' | 'ja' | 'nein' | 'unsicher';

function wantedChoices(jobs: JobLists): Choice<Wanted>[] {
  return [
    { code: 'A', label: 'support', description: `Support-Rolle: ${jobs.supportJobs.join('; ')}` },
    { code: 'B', label: 'ja', description: `anderer Wunschbereich: ${jobs.wantedJobs.join('; ')}` },
    { code: 'C', label: 'nein', description: 'keiner dieser Bereiche' },
    { code: 'D', label: 'unsicher', description: 'Der Text gibt es nicht eindeutig her.' },
  ];
}

export interface JobLists { supportJobs: string[]; wantedJobs: string[] }

function schema(jobs: JobLists): string {
  return JSON.stringify({
    fields: [
      { name: 'wanted_job', description: 'Zu welchem Jobbereich gehört die Stelle?', choices: wantedChoices(jobs) },
      { name: 'erfahrung_ab_3j_erforderlich', description: 'Fordert der Kontext AUSDRÜCKLICH mind. 3 Jahre bzw. mehrjährige Berufserfahrung als VORAUSSETZUNG? "von Vorteil/erwünscht" zählt NICHT. 1-2 Jahre zählt NICHT.', choices: TRI },
    ],
  });
}

const PREFIX_END = 'Context:\n';

export function buildNimblePrompt(field: NimbleField, context: string, jobs: JobLists): string {
  return `${nimblePrefix(jobs)}${context}\n\nField: ${field}`;
}

// Der gemeinsame Präfix aller Prompts (bis einschließlich "Context:\n"). llama-server legt
// Checkpoints nur kurz vor dem ENDE eines Prompts an — also hinter der Stelle, an der der
// nächste Prompt abweicht. Einmal den Präfix allein geschickt setzt einen Checkpoint
// genau dorthin; danach rechnet jede Frage nur noch ihren Kontext (~140 statt ~430 Tokens).
export function nimblePrefix(jobs: JobLists): string {
  return `Schema:\n${schema(jobs)}\n\n${PREFIX_END}`;
}

// Sätze, die Erfahrung UND eine Menge nennen ("mehrjährige Berufserfahrung", "3 Jahre
// Erfahrung", "einschlägige Erfahrung"), je auf SENTENCE_CHARS gekürzt. Gehaltssätze
// ("je nach Erfahrung"), "Nice-to-have: Erfahrung …" oder "seit 41 Jahren" fallen raus —
// mit diesem Rauschen kippte das Urteil je nach Prompt-Variante. Leer → der Text stellt
// keine Mengenforderung, das Modell muss nicht gefragt werden.
export function experienceSentences(text: string, rules: Pick<ExperienceRules, 'experienceWords' | 'disqualifyingPhrases'>): string[] {
  const amount = (s: string) => AMOUNT.test(s) || rules.disqualifyingPhrases.some(p => s.includes(p));
  return text
    .split(/(?<=[.!?;])\s+|\s+[-–•·]\s+/)
    .map(s => s.replace(/^[\s\-–•·]+/, '').trim())
    .filter(s => {
      const lower = s.toLowerCase();
      return rules.experienceWords.some(w => lower.includes(w)) && amount(lower);
    })
    .slice(0, MAX_SENTENCES)
    .map(s => s.slice(0, SENTENCE_CHARS));
}

export function hasJuniorSignal(job: Job, juniorSignals: string[]): boolean {
  const text = `${job.title} ${stripHtml(job.description)}`.toLowerCase();
  return juniorSignals.some(s => text.includes(s));
}


export interface NimbleOptions {
  ask: Ask;
  jobs: JobLists;
  rules: Pick<ExperienceRules, 'experienceWords' | 'disqualifyingPhrases' | 'juniorSignals'>;
}

export interface NimbleJudgment { judgment: FilterJudgment; support: boolean }

export async function judgeJobNimble(job: Job, opts: NimbleOptions): Promise<NimbleJudgment | null> {
  const { ask, jobs, rules } = opts;
  const text = stripHtml(job.description);
  const intro = `Titel: ${job.title}\n${text.slice(0, INTRO_CHARS)}`;

  const wanted = await askField(ask, buildNimblePrompt('wanted_job', intro, jobs), wantedChoices(jobs));
  if (!wanted) return null;

  const sentences = experienceSentences(text, rules);
  const erfahrung = sentences.length === 0
    ? 'nein'
    : await askField(ask, buildNimblePrompt('erfahrung_ab_3j_erforderlich', `Titel: ${job.title}\n${sentences.join('\n')}`, jobs), TRI);
  if (!erfahrung) return null;

  const judgment: FilterJudgment = {
    it_rolle: wanted === 'support' ? 'ja' : wanted,
    erfahrung_ab_3j_erforderlich: erfahrung,
    lehre_coding: 'n/a',
    junior_signal: hasJuniorSignal(job, rules.juniorSignals) ? 'ja' : 'nein',
  };
  return { judgment, support: wanted === 'support' };
}

// model: Preset-Name, Default config.llamacppModelNimble (CPU oder Vulkan).
export function createNimbleStrategy(options: { host?: string; model?: string } & Partial<NimbleOptions> = {}): FilterStrategy {
  const opts: NimbleOptions = {
    ask: options.ask ?? defaultAsk(options.host, options.model),
    jobs: options.jobs ?? loadSettings().nimble,
    rules: options.rules ?? loadExperienceRules(),
  };
  // Einmal pro Strategie (= pro Lauf).
  const prime = primer(opts.ask, () => nimblePrefix(opts.jobs));
  return {
    name: 'nimble',
    async decide(job, lehre) {
      await prime();
      const result = await judgeJobNimble(job, opts);
      if (!result) return mapJudgment(null, lehre);
      // Support: Berufserfahrung ist kein Ausschluss — statt brutal höchstens offstack.
      if (result.support && result.judgment.erfahrung_ab_3j_erforderlich === 'ja') {
        return { status: 'uncertain', judgment: result.judgment };
      }
      return mapJudgment(result.judgment, lehre);
    },
  };
}
