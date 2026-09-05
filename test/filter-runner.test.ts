import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFilter } from '../lib/filter-runner.ts';
import type { FilterDecision } from '../lib/filter.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const sample = (title: string) => toJob({
  source: 'karriere.at',
  url: `https://www.karriere.at/jobs/${encodeURIComponent(title)}`,
  title,
  company: 'Test GmbH',
  description: 'Anforderungen: TypeScript-Kenntnisse.',
});

// Urteil nach Titel-Präfix, damit ein Test die drei Fächer gezielt besetzen kann,
// ohne Ollama oder die Regel-Dateien zu berühren.
const fakeFilter = (job: Job): Promise<FilterDecision> => Promise.resolve({
  job,
  status: job.title.startsWith('M') ? 'matched' : job.title.startsWith('B') ? 'filtered_out' : 'uncertain',
});

async function storageMit(dir: string, jobs: Job[]): Promise<Storage> {
  const storage = createStorage(dir);
  for (const job of jobs) await storage.save(job);
  return storage;
}

test('scope "new": nur ungefilterte Jobs kommen in den Lauf', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const neu = sample('Mneu');
  const alt = sample('Malt');
  const storage = await storageMit(dir, [neu, alt]);
  await storage.update(alt.id, { status: 'triaged', fit: 'matched' });

  const gefiltert: string[] = [];
  const outcome = await runFilter({
    storage, mode: 'regex', writeReport: () => {},
    filter: job => { gefiltert.push(job.title); return fakeFilter(job); },
  });

  assert.deepEqual(gefiltert, ['Mneu']);
  assert.equal(outcome.decisions.length, 1);
});

test('scope "all": jede vorhandene Job-Datei wird neu triagiert', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const neu = sample('Mneu');
  const alt = sample('Malt');
  const storage = await storageMit(dir, [neu, alt]);
  await storage.update(alt.id, { status: 'triaged', fit: 'matched' });

  const gefiltert: string[] = [];
  await runFilter({
    storage, scope: 'all', mode: 'regex', writeReport: () => {},
    filter: job => { gefiltert.push(job.title); return fakeFilter(job); },
  });

  assert.deepEqual(gefiltert.sort(), ['Malt', 'Mneu']);
});

test('onDecision feuert genau einmal pro Job, mit laufendem Index und Gesamtzahl', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = await storageMit(dir, [sample('Meins'), sample('Uzwei'), sample('Bdrei')]);

  const gesehen: { titel: string; i: number; total: number }[] = [];
  await runFilter({
    storage, mode: 'regex', filter: fakeFilter, writeReport: () => {},
    onDecision: (d, i, total) => gesehen.push({ titel: d.job.title, i, total }),
  });

  assert.equal(gesehen.length, 3);
  assert.deepEqual(gesehen.map(g => g.i), [0, 1, 2]);
  assert.ok(gesehen.every(g => g.total === 3));
});

test('onProgress läuft VOR dem Urteil — sonst zeigt die UI den Job erst, wenn er fertig ist', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = await storageMit(dir, [sample('Meins')]);

  const reihenfolge: string[] = [];
  await runFilter({
    storage, mode: 'regex', writeReport: () => {},
    onProgress: () => reihenfolge.push('progress'),
    filter: job => { reihenfolge.push('filter'); return fakeFilter(job); },
    onDecision: () => reihenfolge.push('decision'),
  });

  assert.deepEqual(reihenfolge, ['progress', 'filter', 'decision']);
});

test('Zähler stimmen mit den Entscheidungen überein (uncertain zählt als offstack)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = await storageMit(dir, [
    sample('Meins'), sample('Mzwei'), sample('Udrei'), sample('Bvier'),
  ]);

  const outcome = await runFilter({ storage, mode: 'regex', filter: fakeFilter, writeReport: () => {} });

  assert.equal(outcome.matched, 2);
  assert.equal(outcome.offstack, 1);
  assert.equal(outcome.brutal, 1);
  assert.equal(outcome.decisions.length, 4);
});

// Der eigentliche Anlass für dieses Modul: der UI-Pfad rief writeFilterReport nie,
// und damit fehlten die LLM-Urteile aus UI-Läufen in data/filter-log.md.
test('der Bericht wird vom Runner geschrieben, nicht vom Aufrufer', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = await storageMit(dir, [sample('Meins')]);

  const berichte: { anzahl: number; mode: string }[] = [];
  await runFilter({
    storage, mode: 'llm', filter: fakeFilter,
    writeReport: (decisions, mode) => berichte.push({ anzahl: decisions.length, mode }),
  });

  assert.deepEqual(berichte, [{ anzahl: 1, mode: 'llm' }]);
});

test('leerer Lauf schreibt keinen Bericht — sonst steht ein Kopf ohne Inhalt im Log', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  let gerufen = 0;
  const outcome = await runFilter({
    storage, mode: 'regex', filter: fakeFilter, writeReport: () => { gerufen++; },
  });

  assert.equal(gerufen, 0);
  assert.equal(outcome.decisions.length, 0);
  assert.equal(outcome.matched + outcome.offstack + outcome.brutal, 0);
});

test('der gelaufene Modus steht im Ergebnis, damit Zusammenfassung und Bericht ihn nennen können', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = await storageMit(dir, [sample('Meins')]);

  const outcome = await runFilter({ storage, mode: 'llm', filter: fakeFilter, writeReport: () => {} });
  assert.equal(outcome.mode, 'llm');
});
