import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterJob } from '../lib/filter.ts';
import type { TriagedDecision } from '../lib/filter.ts';
import { writeFilterReport } from '../lib/filter-report.ts';
import { JsonStore } from '../storage/json-store.ts';
import { toJob } from '../lib/normalize.ts';
import { tmpDir, rmTmp, mockChatSequence, mockChat } from './helpers.ts';

const sample = (title = 'Junior Developer') => toJob({
  source: 'karriere.at',
  url: 'https://www.karriere.at/jobs/123',
  title,
  company: 'Test GmbH',
  description: 'Anforderungen: TypeScript-Kenntnisse.',
});

// Antworten des mock llama-server im JEV-Modus (lib/filter-nimble.ts): erst das Priming
// (Antwort egal), dann wanted_job als Buchstabe (A Support, B anderer Wunschbereich,
// C nein). sample() hat keinen Erfahrungssatz → keine Erfahrungsfrage.
const JEV_WANTED = ['', 'B'];

// ── filterJob mit mock llama-server (JEV) ──────────────────────────────────────────

test('filterJob: Wunschbereich, keine Erfahrungsforderung, Junior im Titel → status "matched"', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChatSequence(JEV_WANTED);
  t.after(close);

  const d = await filterJob(job, storage, url, 'nimble');
  assert.equal(d.status, 'matched');
  assert.equal(d.job.fit, 'matched');
  const stored = await storage.get(job.id);
  assert.equal(stored?.status, 'triaged');
  assert.equal(stored?.fit, 'matched');
});

test('filterJob: kein Wunschbereich → status "filtered_out", Datei bleibt erhalten (kein delete)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChatSequence(['', 'C']);
  t.after(close);

  const d = await filterJob(job, storage, url, 'nimble');
  assert.equal(d.status, 'filtered_out');
  assert.equal(d.rejectedBy, 'IT-Rolle');
  assert.equal(d.job.fit, 'brutal');
  // Retain: Datei existiert noch, nichts gelöscht
  const stored = await storage.get(job.id);
  assert.ok(stored !== null);
  assert.equal(stored?.status, 'triaged');
  assert.equal(stored?.fit, 'brutal');
});

test('filterJob: Titel-Regel ("Senior...") → status "filtered_out", KEIN LLM-Call, Datei bleibt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = sample('Senior Fullstack Developer');
  await storage.save(job);

  let called = false;
  const { url, close } = await mockChat('B', () => { called = true; });
  t.after(close);

  const d = await filterJob(job, storage, url, 'nimble');
  assert.equal(d.status, 'filtered_out');
  assert.equal(d.rejectedBy, 'Seniorität (Titel)');
  assert.equal(called, false);
  assert.ok((await storage.get(job.id)) !== null);
});

test('filterJob: kein Junior-Signal → status "uncertain", Datei bleibt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = sample('Developer');
  await storage.save(job);

  const { url, close } = await mockChatSequence(JEV_WANTED);
  t.after(close);

  const d = await filterJob(job, storage, url, 'nimble');
  assert.equal(d.status, 'uncertain');
  assert.equal(d.job.fit, 'offstack');
  const stored = await storage.get(job.id);
  assert.ok(stored !== null);
  assert.equal(stored?.status, 'triaged');
  assert.equal(stored?.fit, 'offstack');
});

test('filterJob: Regex-Modus, disqualifizierende Erfahrung → filtered_out, Datei bleibt (Retain)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = sample('Software Developer');
  job.description = 'Anforderungen: Mind. 3 Jahre Berufserfahrung erforderlich.';
  await storage.save(job);

  const d = await filterJob(job, storage, undefined, 'regex');
  assert.equal(d.status, 'filtered_out');
  assert.match(d.rejectedBy ?? '', /Erfahrung ≥3J/);
  const stored = await storage.get(job.id);
  assert.ok(stored !== null);
  assert.equal(stored?.status, 'triaged');
  assert.equal(stored?.fit, 'brutal');
});

test('filterJob: 2× Müll → "uncertain" statt Absturz', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChatSequence(['', 'Müll 1', 'Müll 2']);
  t.after(close);

  const d = await filterJob(job, storage, url, 'nimble');
  assert.equal(d.status, 'uncertain');
});

// ── writeFilterReport ─────────────────────────────────────────────────────────

function decision(overrides: Partial<TriagedDecision> & { job: ReturnType<typeof sample> }): TriagedDecision {
  return {
    job: overrides.job,
    status: overrides.status ?? 'matched',
    rejectedBy: overrides.rejectedBy,
    judgment: overrides.judgment,
  };
}

// ── Re-Triage darf die Pipeline nicht zurueckspulen ──────────────────────────
//
// Der Bug, der 21 nachweislich versendete Bewerbungen und 33 Jobs mit fertigem
// Anschreiben zurueck in den "Jobs"-Ordner geworfen hat: filterJob() setzte status
// bedingungslos auf "triaged", also warf jeder --scope=all-Lauf alles auf Anfang.

test('filterJob: ein Job ab "generated" behaelt seinen Status, nur fit wird neu gesetzt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);

  for (const status of ['generated', 'freigegeben', 'postausgang', 'gesendet', 'geloescht', 'fehler', 'offline'] as const) {
    const job = { ...sample(`Junior Developer ${status}`), status, fit: 'offstack' as const };
    await storage.save(job);

    const { url, close } = await mockChatSequence(JEV_WANTED);
    t.after(close);
    await filterJob(job, storage, url, 'nimble');

    const stored = await storage.get(job.id);
    assert.equal(stored?.status, status, `Status von "${status}" wurde zurueckgesetzt`);
    // Das Urteil selbst wird sehr wohl aktualisiert — nur die Pipeline-Stufe bleibt.
    assert.equal(stored?.fit, 'matched');
  }
});

test('filterJob: "new" und "triaged" werden weiterhin auf "triaged" gesetzt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);

  for (const status of ['new', 'triaged'] as const) {
    const job = { ...sample(`Junior Developer ${status}`), status };
    await storage.save(job);

    const { url, close } = await mockChatSequence(JEV_WANTED);
    t.after(close);
    await filterJob(job, storage, url, 'nimble');

    assert.equal((await storage.get(job.id))?.status, 'triaged');
  }
});

// Der Lauf kann Minuten dauern. Wird waehrend dieser Zeit ein Anschreiben fertig,
// darf das Ergebnis den Job nicht nachtraeglich doch noch zurueckwerfen — deshalb
// entscheidet filterJob() am aktuellen Diskstand, nicht am uebergebenen Objekt.
test('filterJob: Statuswechsel WAEHREND des Laufs gewinnt gegen das veraltete Objekt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const job = sample();
  await storage.save(job);

  const { url, close } = await mockChatSequence(JEV_WANTED);
  t.after(close);

  // Das, was der Aufrufer in der Hand hat, ist noch "new" — auf Platte steht inzwischen
  // "generated", so wie es lib/anschreiben.ts nach getaner Arbeit hinterlaesst.
  await storage.update(job.id, { status: 'generated' });
  await filterJob(job, storage, url, 'nimble');

  assert.equal((await storage.get(job.id))?.status, 'generated');
});

test('writeFilterReport: drei Fächer mit Aggregat und Summenzeile', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const reportPath = join(dir, 'filter-log.md');
  const job = sample();

  const decisions: TriagedDecision[] = [
    decision({ job, status: 'filtered_out', rejectedBy: 'Seniorität (Titel)' }),
    decision({
      job: { ...job, title: 'Frontend Dev' },
      status: 'uncertain',
      judgment: { it_rolle: 'unsicher', erfahrung_ab_3j_erforderlich: 'nein', lehre_coding: 'n/a', junior_signal: 'nein' },
    }),
    decision({ job: { ...job, title: 'Junior Dev' }, status: 'matched' }),
  ];

  writeFilterReport(decisions, reportPath);
  const content = readFileSync(reportPath, 'utf8');

  assert.ok(content.includes('### Aggregat'));
  assert.ok(content.includes('### Raus (1)'));
  assert.ok(content.includes('Grund: Seniorität (Titel)'));
  assert.ok(content.includes('### Unsicher (1)'));
  assert.ok(content.includes('Frontend Dev'));
  assert.ok(content.includes('it_rolle'));
  assert.ok(content.includes('### Sicher (1)'));
  assert.ok(content.includes('Junior Dev'));
  assert.ok(content.includes('1 sicher, 1 unsicher, 1 raus'));
});

test('writeFilterReport: append-Modus (zwei Läufe → beide Header)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const reportPath = join(dir, 'filter-log.md');
  const job = sample();

  writeFilterReport([decision({ job, status: 'matched' })], reportPath);
  writeFilterReport([decision({ job, status: 'matched' })], reportPath);

  const content = readFileSync(reportPath, 'utf8');
  const matches = content.match(/## Filter-Lauf/g) ?? [];
  assert.equal(matches.length, 2);
});
