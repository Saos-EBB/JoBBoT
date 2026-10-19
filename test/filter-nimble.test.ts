import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNimblePrompt, createNimbleStrategy, nimblePrefix, experienceSentences, hasJuniorSignal, judgeJobNimble } from '../lib/filter-nimble.ts';
import { parseCode } from '../lib/nimble-client.ts';
import type { NimbleOptions } from '../lib/filter-nimble.ts';
import type { Ask } from '../lib/nimble-client.ts';
import { toJob } from '../lib/normalize.ts';
import { mockChatSequence } from './helpers.ts';

const RULES: NimbleOptions['rules'] = {
  experienceWords: ['erfahrung', 'berufserfahrung'],
  disqualifyingPhrases: ['mehrjährige'],
  juniorSignals: ['junior', 'lehre'],
};
const JOBS = { supportJobs: ['IT-Support'], wantedJobs: ['Softwareentwicklung'] };

const sample = (title = 'Junior Developer', description = 'Du entwickelst Web-Apps. Du hast 3 Jahre Erfahrung mit TypeScript.') => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title,
  company: 'Test GmbH',
  description,
});

// Antwort pro Feld aus der letzten Zeile des Prompts ("Field: …"); merkt sich die Prompts.
function askBy(answers: Record<string, string[]>): { ask: Ask; prompts: string[] } {
  const prompts: string[] = [];
  const ask: Ask = async prompt => {
    if (!prompt.includes('Field: ')) return '';  // Priming-Aufruf der Strategie
    prompts.push(prompt);
    const queue = answers[prompt.slice(prompt.lastIndexOf('Field: ') + 7)];
    return queue.length > 1 ? queue.shift()! : queue[0];
  };
  return { ask, prompts };
}
const field = (p: string) => p.slice(p.lastIndexOf('Field: ') + 7);
const opts = (ask: Ask): NimbleOptions => ({ ask, jobs: JOBS, rules: RULES });

test('parseCode: Code → Label, Kleinbuchstabe und Leerraum egal, Unbekanntes → null', () => {
  const choices = [{ code: 'A', label: 'ja' }, { code: 'B', label: 'nein' }];
  assert.equal(parseCode('A', choices), 'ja');
  assert.equal(parseCode(' b\n', choices), 'nein');
  assert.equal(parseCode('', choices), null);
  assert.equal(parseCode('Z', choices), null);
});

test('buildNimblePrompt: Schema für beide Felder wortgleich (Cache-Präfix), Support und Wunschjobs als Antworten', () => {
  const a = buildNimblePrompt('wanted_job', 'Titel: X', JOBS);
  const b = buildNimblePrompt('erfahrung_ab_3j_erforderlich', 'Titel: Y', JOBS);
  assert.ok(a.includes('Support-Rolle: IT-Support'));
  assert.ok(a.includes('anderer Wunschbereich: Softwareentwicklung'));
  assert.equal(a.slice(0, a.indexOf('Context:')), b.slice(0, b.indexOf('Context:')));
  assert.ok(a.endsWith('Context:\nTitel: X\n\nField: wanted_job'));
});

test('experienceSentences: nur Sätze mit Erfahrung UND Mengenangabe', () => {
  const s = experienceSentences('Du entwickelst Apps. Du hast 3 Jahre Erfahrung. Wir bieten Obst.', RULES);
  assert.deepEqual(s, ['Du hast 3 Jahre Erfahrung.']);
  assert.deepEqual(experienceSentences('Du entwickelst Apps. Wir bieten Obst.', RULES), []);
});

test('experienceSentences: Gehalt, Nice-to-have und Firmenalter fallen raus, Aufzählungsstrich weg', () => {
  const text = 'Seit 41 Jahren am Markt. Profil - Mehrjährige Erfahrung im Microsoft Umfeld - Nice-to-have: Erfahrung im Produktionsumfeld. Gehalt je nach Qualifikation & Erfahrung.';
  assert.deepEqual(experienceSentences(text, RULES), ['Mehrjährige Erfahrung im Microsoft Umfeld']);
});

test('hasJuniorSignal: Titel oder Beschreibung', () => {
  assert.equal(hasJuniorSignal(sample('Junior Dev', 'x'), RULES.juniorSignals), true);
  assert.equal(hasJuniorSignal(sample('Dev', 'Ideal für Junior-Profile'), RULES.juniorSignals), true);
  assert.equal(hasJuniorSignal(sample('Dev', 'x'), RULES.juniorSignals), false);
});

test('judgeJobNimble: wanted_job bekommt den Beschreibungsanfang, erfahrung nur den Erfahrungssatz', async () => {
  const { ask, prompts } = askBy({ wanted_job: ['B'], erfahrung_ab_3j_erforderlich: ['B'] });
  const r = await judgeJobNimble(sample(), opts(ask));
  assert.deepEqual(r, { support: false, judgment: { it_rolle: 'ja', erfahrung_ab_3j_erforderlich: 'nein', lehre_coding: 'n/a', junior_signal: 'ja' } });
  assert.deepEqual(prompts.map(field), ['wanted_job', 'erfahrung_ab_3j_erforderlich']);
  assert.ok(prompts[0].includes('Du entwickelst Web-Apps.'));
  assert.ok(!prompts[1].includes('Web-Apps'));
  assert.ok(prompts[1].includes('3 Jahre Erfahrung'));
});

test('judgeJobNimble: kein Erfahrungssatz → erfahrung "nein" ohne Call', async () => {
  const { ask, prompts } = askBy({ wanted_job: ['B'] });
  const r = await judgeJobNimble(sample('Dev', 'Du entwickelst Apps.'), opts(ask));
  assert.equal(r?.judgment.erfahrung_ab_3j_erforderlich, 'nein');
  assert.equal(r?.judgment.junior_signal, 'nein');
  assert.equal(prompts.length, 1);
});

test('Strategie: Lehrstelle wird nicht nach coding-Nähe aussortiert, kein lehre_coding-Call', async () => {
  const { ask, prompts } = askBy({ wanted_job: ['B'], erfahrung_ab_3j_erforderlich: ['B'] });
  const d = await createNimbleStrategy({ ask, jobs: JOBS, rules: RULES }).decide(sample('Lehre Systemtechnik'), true);
  assert.equal(d.status, 'matched');
  assert.equal(d.judgment?.lehre_coding, 'n/a');
  assert.deepEqual(prompts.map(field), ['wanted_job', 'erfahrung_ab_3j_erforderlich']);
});

test('judgeJobNimble: unbrauchbare Antwort → 1 Retry, dann null', async () => {
  const { ask, prompts } = askBy({ wanted_job: ['?'] });
  assert.equal(await judgeJobNimble(sample(), opts(ask)), null);
  assert.equal(prompts.length, 2);
});

test('judgeJobNimble: Retry rettet das Feld', async () => {
  const { ask } = askBy({ wanted_job: ['?', 'B'], erfahrung_ab_3j_erforderlich: ['B'] });
  assert.equal((await judgeJobNimble(sample(), opts(ask)))?.judgment.it_rolle, 'ja');
});

test('Strategie: kein Wunschjob → filtered_out', async () => {
  const { ask } = askBy({ wanted_job: ['C'], erfahrung_ab_3j_erforderlich: ['B'] });
  const d = await createNimbleStrategy({ ask, jobs: JOBS, rules: RULES }).decide(sample(), false);
  assert.equal(d.status, 'filtered_out');
  assert.equal(d.rejectedBy, 'IT-Rolle');
});

test('Strategie: Support + Erfahrung ≥3J → offstack statt brutal', async () => {
  const { ask } = askBy({ wanted_job: ['A'], erfahrung_ab_3j_erforderlich: ['A'] });
  const d = await createNimbleStrategy({ ask, jobs: JOBS, rules: RULES }).decide(sample('Junior IT-Support'), false);
  assert.equal(d.status, 'uncertain');
  assert.equal(d.judgment?.it_rolle, 'ja');
});

test('Strategie: anderer Wunschbereich + Erfahrung ≥3J → weiterhin brutal', async () => {
  const { ask } = askBy({ wanted_job: ['B'], erfahrung_ab_3j_erforderlich: ['A'] });
  const d = await createNimbleStrategy({ ask, jobs: JOBS, rules: RULES }).decide(sample(), false);
  assert.equal(d.status, 'filtered_out');
  assert.equal(d.rejectedBy, 'Erfahrung ≥3J');
});

test('Strategie: Support ohne Erfahrungsforderung + Junior → matched', async () => {
  const { ask } = askBy({ wanted_job: ['A'], erfahrung_ab_3j_erforderlich: ['B'] });
  const d = await createNimbleStrategy({ ask, jobs: JOBS, rules: RULES }).decide(sample('Junior IT-Support'), false);
  assert.equal(d.status, 'matched');
});

test('Strategie: Wurf beim Ask → uncertain, nie Reject', async () => {
  const ask: Ask = async () => { throw new Error('down'); };
  const d = await createNimbleStrategy({ ask, jobs: JOBS, rules: RULES }).decide(sample(), false);
  assert.equal(d.status, 'uncertain');
});

test('Strategie über HTTP: Priming einmal pro Lauf, dann ein Buchstabe pro Feld', async (t) => {
  const { url, close, calls } = await mockChatSequence(['', 'B', 'B', 'B', 'B']);
  t.after(close);
  const strategy = createNimbleStrategy({ host: url, jobs: JOBS, rules: RULES });
  assert.equal((await strategy.decide(sample(), false)).status, 'matched');
  assert.equal(calls(), 3);
  assert.equal((await strategy.decide(sample(), false)).status, 'matched');
  assert.equal(calls(), 5);
});

test('nimblePrefix: Präfix jedes Prompts, endet vor dem Kontext', () => {
  const prefix = nimblePrefix(JOBS);
  assert.ok(buildNimblePrompt('wanted_job', 'Titel: X', JOBS).startsWith(prefix));
  assert.ok(prefix.endsWith('Context:\n'));
});
