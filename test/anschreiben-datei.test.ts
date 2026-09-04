import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { anschreibenName, findAnschreiben } from '../lib/anschreiben-datei.ts';
import { saveAnschreiben } from '../lib/anschreiben.ts';
import { toJob } from '../lib/normalize.ts';
import { tmpDir, rmTmp } from './helpers.ts';
import type { Job } from '../scrapers/interface.ts';

const job = (over: Partial<Job> = {}): Job => ({
  ...toJob({
    source: 'karriere.at', url: 'https://x', title: 'Junior Developer (m/w/d)',
    company: 'Test GmbH', description: 'd',
  }),
  ...over,
});

test('anschreibenName: Titel, Firma und id-Praefix — kein Datum', () => {
  const j = job();
  const name = anschreibenName(j);
  assert.equal(name, `junior-developer-m-w-d_test-gmbh_${j.id.slice(0, 8)}`);
  // Der eigentliche Punkt: kein Datum drin, das sich aendern koennte.
  assert.doesNotMatch(name, /\d{4}-\d{2}-\d{2}/);
});

test('findAnschreiben: nichts da → null, auch wenn der Ordner fehlt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  assert.equal(await findAnschreiben(job(), dir), null);
  assert.equal(await findAnschreiben(job(), join(dir, 'gibtsnicht')), null);
});

// Ursache 1: jobBasename() trug das Datum (postedAt ?? scrapedAt). Ein Re-Scrape
// liefert ein neues postedAt — und der Brief war fuer seinen eigenen Job unsichtbar.
test('findAnschreiben: findet den Brief auch nach einem Re-Scrape mit neuem Datum', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const j = job({ postedAt: '2026-07-20T00:00:00.000Z' });
  await saveAnschreiben(j, 'Mein Anschreiben', dir);

  // Dieselbe Stelle, spaeter neu gescrapt: gleiche id (Titel+Firma unveraendert),
  // aber ein neues Datum.
  const neu = { ...j, postedAt: '2026-08-06T00:00:00.000Z', scrapedAt: '2026-08-06T09:00:00.000Z' };
  const pfad = await findAnschreiben(neu, dir);
  assert.notEqual(pfad, null);
  assert.equal(await readFile(pfad!, 'utf8'), 'Mein Anschreiben');
});

// Ursache 2: der Duplikat-Merge setzt keep.scrapedAt auf das des aeltesten Zwillings
// (planMerge). Damit aenderte sich der Dateiname, und der behaltene Job verlor
// seinen eigenen Brief.
test('findAnschreiben: ein geaendertes scrapedAt (Merge) macht den Brief nicht unsichtbar', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const j = job({ postedAt: null, scrapedAt: '2026-08-20T10:00:00.000Z' });
  await saveAnschreiben(j, 'Brief', dir);

  const nachMerge = { ...j, scrapedAt: '2026-07-01T08:00:00.000Z' };
  assert.notEqual(await findAnschreiben(nachMerge, dir), null);
});

// Der Bestand traegt noch Dateien im alten Schema. Die id-Suche findet sie, damit die
// Migration Aufraeumen ist und keine Voraussetzung.
test('findAnschreiben: findet auch eine Datei im alten Namensschema (mit Datum)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const j = job();
  await writeFile(join(dir, `junior-developer-m-w-d_test-gmbh_2026-07-20_${j.id.slice(0, 8)}.md`), 'alt', 'utf8');

  const pfad = await findAnschreiben(j, dir);
  assert.equal(await readFile(pfad!, 'utf8'), 'alt');
});

// Ohne dieses Aufraeumen laegen nach dem ersten Schreiben im neuen Schema zwei
// Dateien fuer denselben Job da — welche findAnschreiben() erwischt, waere der
// readdir-Reihenfolge ueberlassen.
test('anschreibenZiel: eine Datei unter altem Namen wird beim Schreiben entfernt', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const j = job();
  await writeFile(join(dir, `junior-developer-m-w-d_test-gmbh_2026-07-20_${j.id.slice(0, 8)}.md`), 'alt', 'utf8');

  await saveAnschreiben(j, 'neu', dir);

  const dateien = await readdir(dir);
  assert.deepEqual(dateien, [`${anschreibenName(j)}.md`]);
  assert.equal(await readFile(join(dir, dateien[0]), 'utf8'), 'neu');
});

test('anschreibenZiel: zweimal schreiben lässt genau eine Datei zurück', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const j = job();
  await saveAnschreiben(j, 'erste Fassung', dir);
  await saveAnschreiben(j, 'zweite Fassung', dir);

  assert.equal((await readdir(dir)).length, 1);
  assert.equal(await readFile((await findAnschreiben(j, dir))!, 'utf8'), 'zweite Fassung');
});

// Zwei verschiedene Jobs duerfen sich nicht gegenseitig ausknipsen — die id
// unterscheidet sie, auch wenn die Firma dieselbe ist.
test('findAnschreiben: unterscheidet zwei Jobs derselben Firma', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const a = job();
  const b = job({ title: 'Senior Developer (m/w/d)', id: 'aaaaaaaabbbbbbbb' });
  await saveAnschreiben(a, 'Brief A', dir);
  await saveAnschreiben(b, 'Brief B', dir);

  assert.equal(await readFile((await findAnschreiben(a, dir))!, 'utf8'), 'Brief A');
  assert.equal(await readFile((await findAnschreiben(b, dir))!, 'utf8'), 'Brief B');
});

// AnschreibenLog.md liegt im selben Ordner und endet nicht auf _<id8>.md — darf
// also nie als Anschreiben durchgehen.
test('findAnschreiben: das Laufprotokoll ist kein Anschreiben', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  await writeFile(join(dir, 'AnschreibenLog.md'), '- Lauf', 'utf8');
  assert.equal(await findAnschreiben(job(), dir), null);
});
