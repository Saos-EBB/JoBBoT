import type { Job, JobStatus, ScraperAdapter, ScrapedJob, SourceQuery } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import { toJob } from './normalize.ts';
import { jobId } from './hash.ts';
import { checkOnline as checkOnlineDefault, type OnlineVerdict } from './offline-check.ts';
import { sleep } from './fetch-page.ts';

export interface SourceOutcome {
  name: string;
  ok: boolean;
  newCount: number;
  skipCount: number;
  // In diesem Lauf ins Offline-Archiv verschoben (siehe Offline-Durchgang unten).
  offlineCount: number;
  error?: unknown;
}

// Nur diese Status werden archiviert. Ab "generated" steckt eigene Arbeit im Job —
// ein geschriebenes Anschreiben, eine Freigabe, ein Versand. Die wegzusortieren, weil
// das Portal das Inserat gezogen hat, waere falsch: die Bewerbung laeuft ja.
// Nebenwirkung, auf die sich das Zurueckholen stuetzt: aus diesen zwei Status ist der
// Vorzustand verlustfrei ableitbar (fit == null ? 'new' : 'triaged').
const ARCHIVIERBAR = new Set<JobStatus>(['new', 'triaged']);

// Obergrenze fuer Nachprueffungen PRO LAUF. Ohne sie feuerte jeder Scrape-Lauf einen
// Request pro nicht gefundenem Job — beim aktuellen Bestand ~250, davon ~200 an
// LinkedIn. devjobs.at hat beim Nachmessen schon auf den ERSTEN Request mit 429
// geantwortet; ein solcher Schwall setzt den ganzen Scraper aufs Spiel, um ein paar
// Karteileichen zu finden. Was nicht drankommt, kommt beim naechsten Lauf dran.
const MAX_OFFLINE_CHECKS = 25;
const OFFLINE_CHECK_PAUSE_MS = 1000;

export interface RunScrapeOptions {
  names: string[];
  registry: Record<string, ScraperAdapter>;
  queriesFor: (name: string) => SourceQuery[];
  keep?: (job: ScrapedJob) => boolean;
  storage: Storage;
  onProgress?: (name: string, current: number, total: number) => void;
  onUnitDone?: (name: string, items: ScrapedJob[]) => void;
  maxConcurrent?: number;
  maxBrowsers?: number;
  // Injizierbar, damit Tests den Offline-Durchgang ohne Netz durchspielen koennen.
  checkOnline?: (job: { source: string; url: string }) => Promise<OnlineVerdict>;
  maxOfflineChecks?: number;
  offlineCheckPauseMs?: number;
}

// Ein Scheduler statt zwei unabhängiger Semaphoren: acquire() prüft BEIDE Limits
// atomar und committet nur, wenn beide Platz haben — sonst wird gewartet, ohne
// eines der beiden Kontingente teilweise zu belegen. Zwei getrennte Semaphoren
// (erst Browser-Slot, dann Gesamt-Slot) führten im Live-Lauf zu Starvation: ein
// Browser-Adapter griff sich zuerst den knappen Browser-Slot, hing dann aber in
// der Gesamt-Slot-Queue fest — und blockierte damit den zweiten Browser-Adapter
// von seinem eigentlich freien Browser-Slot, teils minutenlang. release() weckt
// alle Wartenden; nur wer beide Limits jetzt erfüllt, kommt tatsächlich durch.
function createScheduler(maxConcurrent: number, maxBrowsers: number) {
  let active = 0;
  let activeBrowsers = 0;
  let queue: (() => void)[] = [];

  function tryAcquire(isBrowser: boolean): boolean {
    if (active >= maxConcurrent) return false;
    if (isBrowser && activeBrowsers >= maxBrowsers) return false;
    active++;
    if (isBrowser) activeBrowsers++;
    return true;
  }

  async function acquire(isBrowser: boolean): Promise<void> {
    while (!tryAcquire(isBrowser)) {
      await new Promise<void>(resolve => queue.push(resolve));
    }
  }

  function release(isBrowser: boolean): void {
    active--;
    if (isBrowser) activeBrowsers--;
    const waiting = queue;
    queue = [];
    waiting.forEach(resolve => resolve());
  }

  return { acquire, release };
}

// Alle Quellen parallel, aber gedrosselt: max `maxConcurrent` Adapter gleichzeitig
// insgesamt, UND max `maxBrowsers` kind:"browser"-Adapter gleichzeitig — nie zwei
// Playwright-Browser parallel, die sich lokal um CPU/Netzwerk streiten. allSettled
// bleibt: ein Adapter-Fehler stoppt die anderen nicht. Dedup+Save erst NACH allen
// Ergebnissen sequenziell (verhindert Write-Races, wenn dieselbe Stelle auf zwei
// Quellen mit gleicher jobId auftaucht).
export async function runScrape(options: RunScrapeOptions): Promise<SourceOutcome[]> {
  const {
    names, registry, queriesFor, keep, storage, onProgress, onUnitDone,
    maxConcurrent = 2, maxBrowsers = 1,
    checkOnline = checkOnlineDefault,
    maxOfflineChecks = MAX_OFFLINE_CHECKS,
    offlineCheckPauseMs = OFFLINE_CHECK_PAUSE_MS,
  } = options;

  const scheduler = createScheduler(maxConcurrent, maxBrowsers);

  const settled = await Promise.allSettled(names.map(async name => {
    // Ohne diese Zeile wurde aus einem Portalnamen ohne Adapter ein
    // "Cannot read properties of undefined (reading 'kind')" — als abgelehnte Promise
    // getarnt als Quellen-Fehlschlag, ohne zu sagen woran es lag.
    const adapter = registry[name];
    if (!adapter) throw new Error(`Kein Adapter für Quelle "${name}" — bekannt sind: ${Object.keys(registry).join(', ')}`);
    const isBrowser = adapter.kind === 'browser';
    await scheduler.acquire(isBrowser);
    try {
      return await adapter.scrape(
        queriesFor(name),
        keep,
        (current, total) => onProgress?.(name, current, total),
        items => onUnitDone?.(name, items),
      );
    } finally {
      scheduler.release(isBrowser);
    }
  }));

  // Ein einziges list() statt eines exists() pro Ergebnis: exists() liest intern vier
  // Ordner-Listings, das waren bei ~250 Treffern ~1000 readdir-Aufrufe pro Lauf. Die
  // Map deckt Dedup-Pruefung und Offline-Durchgang zugleich ab.
  // Bekannte Einschraenkung: liegen fuer eine id ZWEI Dateien (Altbestand aus einer
  // Zeit vor der jetzigen hash.ts, siehe lib/duplicates.ts), gewinnt hier die zuletzt
  // gelesene — und ein spaeteres storage.update() trifft ohnehin nur eine der beiden.
  // Das ist das bestehende Duplikat-Thema, `npm run duplicates` raeumt es auf.
  const bekannt = new Map<string, Job>();
  for (const job of await storage.list()) bekannt.set(job.id, job);

  // Wer in DIESEM Lauf von irgendeiner Quelle geliefert wurde, steht sicher noch online.
  const gesehen = new Set<string>();
  // Nur Quellen, die tatsaechlich liefen UND durchkamen. Eine uebersprungene oder
  // gescheiterte Quelle darf ihren Bestand nicht ins Archiv schieben.
  const gelaufen = new Set<string>();

  const outcomes: SourceOutcome[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const result = settled[i];

    if (result.status === 'rejected') {
      outcomes.push({ name, ok: false, newCount: 0, skipCount: 0, offlineCount: 0, error: result.reason });
      continue;
    }
    gelaufen.add(name);

    let newCount = 0, skipCount = 0;
    for (const scraped of result.value) {
      const id = jobId(scraped);
      gesehen.add(id);
      if (bekannt.has(id)) { skipCount++; }
      else {
        const job = toJob(scraped);
        await storage.save(job);
        // Sofort in die Map, sonst zaehlt dieselbe Stelle aus einer zweiten Quelle
        // im selben Lauf noch einmal als "neu".
        bekannt.set(id, job);
        newCount++;
      }
    }
    outcomes.push({ name, ok: true, newCount, skipCount, offlineCount: 0 });
  }

  await archiviereOffline({
    bekannt, gesehen, gelaufen, outcomes, storage,
    checkOnline, maxOfflineChecks, offlineCheckPauseMs,
  });

  return outcomes;
}

interface OfflinePassOptions {
  bekannt: Map<string, Job>;
  gesehen: Set<string>;
  gelaufen: Set<string>;
  outcomes: SourceOutcome[];
  storage: Storage;
  checkOnline: (job: { source: string; url: string }) => Promise<OnlineVerdict>;
  maxOfflineChecks: number;
  offlineCheckPauseMs: number;
}

// Zwei Stufen, absichtlich: "im Lauf nicht gefunden" waehlt die KANDIDATEN aus (gratis,
// die Ergebnisse liegen schon vor), ein Einzelabruf der Job-URL BESTAETIGT jeden davon
// (lib/offline-check.ts).
//
// Warum nicht die billige Stufe allein: "nicht gefunden" heisst hier regelmaessig etwas
// anderes als "offline". Die Suchanfragen sind ueber die Einstellungsseite frei
// editierbar — nach einer Aenderung von "Linz" auf "Wels" waere der halbe Bestand
// nicht gefunden. Dazu kommen Pagination-Deckel: ein vor Wochen gescraptes Inserat
// steht laengst nicht mehr auf Seite 1 und ist trotzdem online. Ein still archivierter
// lebender Job ist ein verpasster Job; ein Lauf zu spaet archivierter kostet nichts.
//
// Warum nicht die teure Stufe allein: das waeren ~250 Extra-Requests pro Lauf.
async function archiviereOffline(o: OfflinePassOptions): Promise<void> {
  const kandidaten = [...o.bekannt.values()]
    .filter(job => ARCHIVIERBAR.has(job.status) && !o.gesehen.has(job.id) && o.gelaufen.has(job.source))
    // Aeltestes Inserat zuerst: dort ist die Trefferquote am hoechsten, und die Reihe
    // leert sich von selbst (was archiviert wird, faellt aus ARCHIVIERBAR heraus und
    // gibt seinen Platz frei). Der Preis dafuer ist ehrlich zu benennen: ein altes,
    // aber dauerhaft lebendes Inserat belegt seinen Platz Lauf fuer Lauf.
    .sort((a, b) => a.scrapedAt.localeCompare(b.scrapedAt))
    .slice(0, o.maxOfflineChecks);

  const perSource = new Map(o.outcomes.map(out => [out.name, out]));

  for (let i = 0; i < kandidaten.length; i++) {
    const job = kandidaten[i];
    // Nur ein GEPRUEFTES Offline-Signal archiviert. 'unbekannt' (Rate-Limit, Timeout,
    // oder eine Quelle ohne nachgemessenen Marker) laesst den Job unangetastet.
    if (await o.checkOnline(job) === 'offline') {
      await o.storage.update(job.id, { status: 'offline' });
      const out = perSource.get(job.source);
      if (out) out.offlineCount++;
    }
    if (i < kandidaten.length - 1 && o.offlineCheckPauseMs > 0) await sleep(o.offlineCheckPauseMs);
  }
}
