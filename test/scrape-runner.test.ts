import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../lib/scrape-runner.ts';
import { createStorage } from '../storage/index.ts';
import type { Job, ScraperAdapter, ScrapedJob } from '../scrapers/interface.ts';
import type { OnlineVerdict } from '../lib/offline-check.ts';
import { toJob } from '../lib/normalize.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const job = (title: string, company: string): ScrapedJob => ({
  source: 'test', url: `https://example.com/${title}`, title, company, description: '',
});

function okAdapter(name: string, jobs: ScrapedJob[], kind: 'fetch' | 'browser' = 'fetch'): ScraperAdapter {
  return { name, kind, querySchema: [], async scrape() { return jobs; } };
}

function failingAdapter(name: string, message: string, kind: 'fetch' | 'browser' = 'fetch'): ScraperAdapter {
  return { name, kind, querySchema: [], async scrape() { throw new Error(message); } };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

test('2 erfolgreiche Quellen + 1 werfende → Erfolge liefern Jobs, Fehler wird gemeldet, Lauf bricht nicht ab', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const registry: Record<string, ScraperAdapter> = {
    a: okAdapter('a', [job('Job A1', 'Firma A')]),
    b: okAdapter('b', [job('Job B1', 'Firma B'), job('Job B2', 'Firma B')]),
    c: failingAdapter('c', 'netzwerk kaputt'),
  };

  const outcomes = await runScrape({
    names: ['a', 'b', 'c'],
    registry,
    queriesFor: () => [],
    storage,
  });

  assert.equal(outcomes.length, 3);
  const byName = Object.fromEntries(outcomes.map(o => [o.name, o]));
  assert.equal(byName.a.ok, true);
  assert.equal(byName.a.newCount, 1);
  assert.equal(byName.b.ok, true);
  assert.equal(byName.b.newCount, 2);
  assert.equal(byName.c.ok, false);
  assert.match(String(byName.c.error), /netzwerk kaputt/);

  const saved = await storage.list();
  assert.equal(saved.length, 3);
});

test('dieselbe jobId aus zwei Quellen → nur 1 Datei, Zähler stimmt (neu bei erster, dedup bei zweiter)', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const sameJob = job('Duplicate Job', 'Same Company');
  const registry: Record<string, ScraperAdapter> = {
    a: okAdapter('a', [sameJob]),
    b: okAdapter('b', [{ ...sameJob }]),
  };

  const outcomes = await runScrape({
    names: ['a', 'b'],
    registry,
    queriesFor: () => [],
    storage,
  });

  const byName = Object.fromEntries(outcomes.map(o => [o.name, o]));
  assert.equal(byName.a.newCount, 1);
  assert.equal(byName.a.skipCount, 0);
  assert.equal(byName.b.newCount, 0);
  assert.equal(byName.b.skipCount, 1);

  const saved = await storage.list();
  assert.equal(saved.length, 1);
});

test('keep-Filter wird an jeden Adapter durchgereicht', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  let receivedKeep: ((job: ScrapedJob) => boolean) | undefined;
  const registry: Record<string, ScraperAdapter> = {
    a: {
      name: 'a',
      kind: 'fetch',
      querySchema: [],
      async scrape(_queries, keepFn) {
        receivedKeep = keepFn;
        return [];
      },
    },
  };
  const keep = (j: ScrapedJob) => j.title === 'nope';

  await runScrape({ names: ['a'], registry, queriesFor: () => [], keep, storage });
  assert.equal(receivedKeep, keep);
});

test('onProgress wird pro Quelle mit ihrem Namen aufgerufen', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const calls: { name: string; current: number; total: number }[] = [];
  const registry: Record<string, ScraperAdapter> = {
    a: {
      name: 'a',
      kind: 'fetch',
      querySchema: [],
      async scrape(_queries, _keep, onProgress) {
        onProgress?.(1, 2);
        onProgress?.(2, 2);
        return [];
      },
    },
  };

  await runScrape({
    names: ['a'],
    registry,
    queriesFor: () => [],
    storage,
    onProgress: (name, current, total) => calls.push({ name, current, total }),
  });

  assert.deepEqual(calls, [{ name: 'a', current: 1, total: 2 }, { name: 'a', current: 2, total: 2 }]);
});

// ── Scheduler: Concurrency-Limits ────────────────────────────────────────────

function trackingAdapter(name: string, kind: 'fetch' | 'browser', ms: number, tracker: { active: number; max: number; activeBrowsers: number; maxBrowsers: number }): ScraperAdapter {
  return {
    name,
    kind,
    querySchema: [],
    async scrape() {
      tracker.active++;
      if (kind === 'browser') tracker.activeBrowsers++;
      tracker.max = Math.max(tracker.max, tracker.active);
      tracker.maxBrowsers = Math.max(tracker.maxBrowsers, tracker.activeBrowsers);
      await delay(ms);
      tracker.active--;
      if (kind === 'browser') tracker.activeBrowsers--;
      return [];
    },
  };
}

test('Scheduler: nie mehr als 2 Adapter gleichzeitig aktiv', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    a: trackingAdapter('a', 'fetch', 30, tracker),
    b: trackingAdapter('b', 'fetch', 30, tracker),
    c: trackingAdapter('c', 'fetch', 30, tracker),
    d: trackingAdapter('d', 'fetch', 30, tracker),
  };

  await runScrape({ names: ['a', 'b', 'c', 'd'], registry, queriesFor: () => [], storage });
  assert.ok(tracker.max <= 2, `erwartet ≤2 gleichzeitig, war ${tracker.max}`);
});

test('Scheduler: nie 2 Browser-Adapter gleichzeitig, auch wenn Gesamt-Slot frei wäre', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    browser1: trackingAdapter('browser1', 'browser', 30, tracker),
    browser2: trackingAdapter('browser2', 'browser', 30, tracker),
    fetch1: trackingAdapter('fetch1', 'fetch', 30, tracker),
  };

  await runScrape({ names: ['browser1', 'browser2', 'fetch1'], registry, queriesFor: () => [], storage });
  assert.ok(tracker.maxBrowsers <= 1, `erwartet ≤1 Browser gleichzeitig, war ${tracker.maxBrowsers}`);
  assert.ok(tracker.max <= 2, `erwartet ≤2 gleichzeitig, war ${tracker.max}`);
});

test('Scheduler: ein Fetch-Adapter darf neben einem laufenden Browser-Adapter laufen', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    browser1: trackingAdapter('browser1', 'browser', 40, tracker),
    fetch1: trackingAdapter('fetch1', 'fetch', 10, tracker),
  };

  await runScrape({ names: ['browser1', 'fetch1'], registry, queriesFor: () => [], storage });
  assert.equal(tracker.max, 2, `browser+fetch sollten gleichzeitig laufen, war ${tracker.max}`);
});

test('Scheduler: werfender Adapter blockiert die anderen nicht, auch unter Drosselung', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    fails: { name: 'fails', kind: 'browser', querySchema: [], async scrape() { throw new Error('boom'); } },
    a: trackingAdapter('a', 'fetch', 10, tracker),
    b: trackingAdapter('b', 'fetch', 10, tracker),
  };

  const outcomes = await runScrape({ names: ['fails', 'a', 'b'], registry, queriesFor: () => [], storage });
  const byName = Object.fromEntries(outcomes.map(o => [o.name, o]));
  assert.equal(byName.fails.ok, false);
  assert.equal(byName.a.ok, true);
  assert.equal(byName.b.ok, true);
});

function timedAdapter(name: string, kind: 'fetch' | 'browser', ms: number, starts: Record<string, number>, t0: number): ScraperAdapter {
  return {
    name,
    kind,
    querySchema: [],
    async scrape() {
      starts[name] = performance.now() - t0;
      await delay(ms);
      return [];
    },
  };
}

// Regression: im Live-Lauf blockierte ein Browser-Adapter (der auf den knapperen
// Browser-Slot wartete) einen längst bereiten Fetch-Adapter, weil er zuerst einen
// allgemeinen Slot ergattert hatte und ihn nutzlos festhielt. Fix: Browser-Slot
// wird VOR dem allgemeinen Slot erworben, ein wartender Browser-Adapter belegt
// also nie einen allgemeinen Slot ohne ihn zu nutzen.
test('Scheduler: ein wartender Browser-Adapter blockiert einen bereiten Fetch-Adapter NICHT', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const t0 = performance.now();
  const starts: Record<string, number> = {};
  const registry: Record<string, ScraperAdapter> = {
    browser1: timedAdapter('browser1', 'browser', 150, starts, t0),
    browser2: timedAdapter('browser2', 'browser', 20, starts, t0),
    fetch1: timedAdapter('fetch1', 'fetch', 20, starts, t0),
    fetch2: timedAdapter('fetch2', 'fetch', 20, starts, t0),
  };

  await runScrape({
    names: ['browser1', 'browser2', 'fetch1', 'fetch2'],
    registry,
    queriesFor: () => [],
    storage,
  });

  // fetch2 muss starten, sobald fetch1 fertig ist (~20ms) — NICHT erst wenn
  // browser1 nach 150ms fertig ist und browser2 aus der Browser-Queue entlässt.
  assert.ok(starts.fetch2 < 100, `fetch2 sollte lange vor browser1s Ende starten, startete bei ${starts.fetch2}ms`);
  // browser2 darf erst starten, nachdem browser1 den Browser-Slot freigegeben hat.
  assert.ok(starts.browser2 >= 140, `browser2 sollte erst nach browser1 (150ms) starten, startete bei ${starts.browser2}ms`);
});

test('Scheduler: maxConcurrent/maxBrowsers per Option überschreibbar', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);

  const tracker = { active: 0, max: 0, activeBrowsers: 0, maxBrowsers: 0 };
  const registry: Record<string, ScraperAdapter> = {
    b1: trackingAdapter('b1', 'browser', 20, tracker),
    b2: trackingAdapter('b2', 'browser', 20, tracker),
  };

  await runScrape({ names: ['b1', 'b2'], registry, queriesFor: () => [], storage, maxConcurrent: 2, maxBrowsers: 2 });
  assert.equal(tracker.maxBrowsers, 2);
});

// Ein Portalname ohne Adapter (z.B. ein Altbestand in config/sources.json) lief vorher
// auf `registry[name].kind` eines undefined und kam als nichtssagender Quellen-Fehlschlag
// zurück. Jetzt sagt die Meldung, woran es lag — und die anderen Quellen laufen weiter.
test('unbekannte Quelle: sprechender Fehler statt undefined-Zugriff', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const outcomes = await runScrape({
    names: ['gibtsnicht', 'a'],
    registry: { a: okAdapter('a', [job('T', 'F')]) },
    queriesFor: () => [{}],
    storage,
  });
  const fehlt = outcomes.find(o => o.name === 'gibtsnicht')!;
  assert.equal(fehlt.ok, false);
  assert.match(String(fehlt.error), /Kein Adapter für Quelle "gibtsnicht"/);
  assert.match(String(fehlt.error), /bekannt sind: a/);
  assert.equal(outcomes.find(o => o.name === 'a')!.ok, true);
});

// ── Offline-Archiv ───────────────────────────────────────────────────────────
//
// Zwei Stufen: "im Lauf nicht gefunden" waehlt die Kandidaten aus, ein Einzelabruf
// bestaetigt. Geprueft wird hier vor allem, dass die BESTAETIGUNG das letzte Wort hat —
// die billige erste Stufe hat in der Praxis regelmaessig unrecht (geaenderte
// Suchanfrage, Pagination-Deckel).

// Legt einen Job direkt im Store an, so wie ihn ein frueherer Lauf hinterlassen haette.
async function gespeichert(
  storage: ReturnType<typeof createStorage>,
  scraped: ScrapedJob,
  patch: Partial<Job> = {},
): Promise<Job> {
  const j = { ...toJob(scraped), ...patch };
  await storage.save(j);
  return j;
}

// Der Offline-Durchgang prueft nur Jobs, deren Quelle in DIESEM Lauf lief. Gespeicherte
// Jobs muessen also dieselbe `source` tragen wie der Adapter heisst — sonst testet man
// versehentlich nur, dass gar nichts passiert.
const jobVon = (quelle: string, title: string, company: string): ScrapedJob =>
  ({ ...job(title, company), source: quelle });

// Fake-Pruefung: Urteil je URL, Standard 'unbekannt'. Zaehlt mit, was abgefragt wurde.
function fakeCheck(urteile: Record<string, OnlineVerdict>) {
  const gefragt: string[] = [];
  const fn = async (j: { source: string; url: string }) => {
    gefragt.push(j.url);
    return urteile[j.url] ?? 'unbekannt';
  };
  return { fn, gefragt };
}

const offlineOpts = { maxOfflineChecks: 50, offlineCheckPauseMs: 0 };

test('offline: nicht gefunden UND bestaetigt offline → wandert ins Archiv', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const alt = await gespeichert(storage, jobVon('a', 'Alter Job', 'Firma A'), { status: 'triaged', fit: 'matched' });

  const check = fakeCheck({ [alt.url]: 'offline' });
  const outcomes = await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', [job('Neuer Job', 'Firma A')]) },
    queriesFor: () => [],
    storage,
    checkOnline: check.fn,
    ...offlineOpts,
  });

  assert.equal((await storage.get(alt.id))!.status, 'offline');
  assert.equal(outcomes[0].offlineCount, 1);
  assert.deepEqual(check.gefragt, [alt.url]);
});

// Der Kern der Entscheidung fuer die zweite Stufe: eine geaenderte Suchanfrage oder ein
// Pagination-Deckel laesst lebende Jobs aus dem Lauf verschwinden. Wuerde schon
// "nicht gefunden" archivieren, waeren sie still weg.
test('offline: nicht gefunden, aber noch online → bleibt unangetastet', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const alt = await gespeichert(storage, jobVon('a', 'Alter Job', 'Firma A'), { status: 'triaged', fit: 'matched' });

  const outcomes = await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', []) },
    queriesFor: () => [],
    storage,
    checkOnline: fakeCheck({ [alt.url]: 'online' }).fn,
    ...offlineOpts,
  });

  assert.equal((await storage.get(alt.id))!.status, 'triaged');
  assert.equal(outcomes[0].offlineCount, 0);
});

test('offline: "unbekannt" (Rate-Limit, Timeout) archiviert nicht', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const alt = await gespeichert(storage, jobVon('a', 'Alter Job', 'Firma A'), { status: 'new' });

  await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', []) },
    queriesFor: () => [],
    storage,
    checkOnline: async () => 'unbekannt' as OnlineVerdict,
    ...offlineOpts,
  });

  assert.equal((await storage.get(alt.id))!.status, 'new');
});

test('offline: im Lauf gefundene Jobs werden gar nicht erst geprueft', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const da = jobVon('a', 'Immer noch da', 'Firma A');
  await gespeichert(storage, da, { status: 'triaged', fit: 'matched' });

  const check = fakeCheck({});
  await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', [da]) },
    queriesFor: () => [],
    storage,
    checkOnline: check.fn,
    ...offlineOpts,
  });

  assert.deepEqual(check.gefragt, []);
});

// Eine gescheiterte Quelle liefert null Treffer — waere ihr Bestand Kandidat, loeschte
// ein einziger Netzwerkausfall die halbe Bibliothek ins Archiv.
test('offline: gescheiterte Quelle archiviert ihren Bestand nicht', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const alt = await gespeichert(storage, jobVon('kaputt', 'Alter Job', 'Firma A'), { status: 'new' });

  const check = fakeCheck({ [alt.url]: 'offline' });
  await runScrape({
    names: ['kaputt'],
    registry: { kaputt: failingAdapter('kaputt', 'netz weg') },
    queriesFor: () => [],
    storage,
    checkOnline: check.fn,
    ...offlineOpts,
  });

  assert.equal((await storage.get(alt.id))!.status, 'new');
  assert.deepEqual(check.gefragt, []);
});

// Das UI laesst eine Teilmenge der Quellen scrapen. Wer nicht mitlief, darf auch nichts
// verlieren.
test('offline: eine Quelle, die in diesem Lauf gar nicht lief, bleibt aussen vor', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const fremd = await gespeichert(storage, jobVon('b', 'Fremder Job', 'Firma B'), { status: 'new' });

  const check = fakeCheck({ [fremd.url]: 'offline' });
  await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', []), b: okAdapter('b', []) },
    queriesFor: () => [],
    storage,
    checkOnline: check.fn,
    ...offlineOpts,
  });

  assert.equal((await storage.get(fremd.id))!.status, 'new');
  assert.deepEqual(check.gefragt, []);
});

// Ab "generated" steckt eigene Arbeit im Job (Anschreiben, Freigabe, Versand). Dass das
// Portal das Inserat gezogen hat, beendet die laufende Bewerbung nicht.
test('offline: ab "generated" wird nicht archiviert, auch wenn das Inserat weg ist', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const eigene: Job[] = [];
  for (const [i, status] of (['generated', 'freigegeben', 'postausgang', 'gesendet'] as const).entries()) {
    eigene.push(await gespeichert(storage, jobVon('a', `Job ${i}`, 'Firma A'), { status }));
  }

  const check = fakeCheck(Object.fromEntries(eigene.map(j => [j.url, 'offline' as OnlineVerdict])));
  await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', []) },
    queriesFor: () => [],
    storage,
    checkOnline: check.fn,
    ...offlineOpts,
  });

  for (const j of eigene) assert.notEqual((await storage.get(j.id))!.status, 'offline');
  assert.deepEqual(check.gefragt, []);
});

// Ohne Deckel feuerte jeder Lauf einen Request pro nicht gefundenem Job — beim
// aktuellen Bestand ~250. Der Rest kommt beim naechsten Lauf dran.
test('offline: hoechstens maxOfflineChecks Abrufe pro Lauf, aeltestes Inserat zuerst', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const alt = await gespeichert(storage, jobVon('a', 'Ganz alt', 'Firma A'), { status: 'new', scrapedAt: '2020-01-01T00:00:00.000Z' });
  const mittel = await gespeichert(storage, jobVon('a', 'Mittelalt', 'Firma A'), { status: 'new', scrapedAt: '2024-01-01T00:00:00.000Z' });
  await gespeichert(storage, jobVon('a', 'Frisch', 'Firma A'), { status: 'new', scrapedAt: '2026-01-01T00:00:00.000Z' });

  const check = fakeCheck({});
  await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', []) },
    queriesFor: () => [],
    storage,
    checkOnline: check.fn,
    maxOfflineChecks: 2,
    offlineCheckPauseMs: 0,
  });

  assert.deepEqual(check.gefragt, [alt.url, mittel.url]);
});

// Reversibilitaet: ein Archiv, aus dem nichts zurueckkommt, waere ein Loeschen mit
// besserem Namen. Ohne gespeichertes previousStatus — new und triaged unterscheidet
// genau das fit-Feld, und nur diese beiden werden ueberhaupt archiviert.
test('offline: wieder aufgetauchter getriagter Job kommt als "triaged" zurueck', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const wieder = jobVon('a', 'Wieder da', 'Firma A');
  const archiviert = await gespeichert(storage, wieder, { status: 'offline', fit: 'matched' });

  const outcomes = await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', [wieder]) },
    queriesFor: () => [],
    storage,
    checkOnline: async () => 'offline' as OnlineVerdict,
    ...offlineOpts,
  });

  const zurueck = (await storage.get(archiviert.id))!;
  assert.equal(zurueck.status, 'triaged');
  assert.equal(zurueck.fit, 'matched');
  assert.equal(outcomes[0].backCount, 1);
  // Zurueckgeholt heisst nicht neu: die Datei war ja schon da.
  assert.equal(outcomes[0].newCount, 0);
  assert.equal(outcomes[0].skipCount, 1);
});

test('offline: ein nie getriagter Job kommt als "new" zurueck', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const wieder = jobVon('a', 'Ungefiltert', 'Firma A');
  const archiviert = await gespeichert(storage, wieder, { status: 'offline', fit: null });

  await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', [wieder]) },
    queriesFor: () => [],
    storage,
    ...offlineOpts,
  });

  assert.equal((await storage.get(archiviert.id))!.status, 'new');
});

// Nur der Status wird angefasst. Alles, was seit dem Archivieren am Job haengt
// (gefundene Mailadresse, Antwortdatum), muss den Weg zurueck ueberleben.
test('offline: das Zurueckholen setzt nur den Status, nichts sonst', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const wieder = jobVon('a', 'Mit Mail', 'Firma A');
  const archiviert = await gespeichert(storage, wieder, {
    status: 'offline', fit: 'offstack', email: 'bewerbung@firma.at',
  });

  await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', [wieder]) },
    queriesFor: () => [],
    storage,
    ...offlineOpts,
  });

  const zurueck = (await storage.get(archiviert.id))!;
  assert.equal(zurueck.status, 'triaged');
  assert.equal(zurueck.email, 'bewerbung@firma.at');
  assert.equal(zurueck.scrapedAt, archiviert.scrapedAt);
});

// Ein zurueckgeholter Job ist in diesem Lauf gesehen worden — er darf im selben
// Durchgang nicht gleich wieder als Offline-Kandidat auftauchen.
test('offline: ein zurueckgeholter Job wird im selben Lauf nicht erneut geprueft', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = createStorage(dir);
  const wieder = jobVon('a', 'Wieder da', 'Firma A');
  const archiviert = await gespeichert(storage, wieder, { status: 'offline', fit: 'matched' });

  const check = fakeCheck({ [wieder.url]: 'offline' });
  await runScrape({
    names: ['a'],
    registry: { a: okAdapter('a', [wieder]) },
    queriesFor: () => [],
    storage,
    checkOnline: check.fn,
    ...offlineOpts,
  });

  assert.deepEqual(check.gefragt, []);
  assert.equal((await storage.get(archiviert.id))!.status, 'triaged');
});
