import { fetchPage } from './fetch-page.ts';

// Ergebnis EINER Prüfung, ob ein gespeichertes Inserat noch online steht.
//
// Drei Werte statt eines Booleans, weil "wir konnten es nicht feststellen" der
// häufigste Fall ist und sich von "es ist weg" unterscheiden MUSS: nur 'offline'
// löst das Archivieren aus (siehe lib/scrape-runner.ts). Alles Unklare lässt den
// Job in Ruhe. Ein falsch archivierter Job verschwindet still aus der Liste — ein
// nicht archivierter steht bloß einen Lauf länger da.
//
//   'offline'   — geprüftes Offline-Signal (404/410, oder ein quellenspezifischer Marker)
//   'online'    — geprüftes Online-Signal; gibt es nur, wo ein Marker nachgemessen ist
//   'unbekannt' — keine Aussage: Rate-Limit, Timeout, Serverfehler, oder eine Quelle
//                 ohne nachgemessenen Marker
export type OnlineVerdict = 'offline' | 'online' | 'unbekannt';

// Die Form, die fetchPage() liefert — hier als eigener Typ, damit Tests einen
// Fake einsetzen können, ohne ins Netz zu gehen.
export interface PageResult {
  ok: boolean;
  status: number;
  html: string;
  finalUrl: string;
}

export type PageFetcher = (url: string) => Promise<PageResult>;

// Codes, die auf jeder Quelle dasselbe heißen: die Ressource ist weg. Bewusst kurz —
// 403 gehört NICHT dazu (das ist ein Bot-Schutz, kein gelöschtes Inserat), 5xx auch
// nicht, und 429 schon gar nicht: devjobs.at hat beim Nachmessen auf den allerersten
// Request mit 429 geantwortet. Ein als "offline" gelesenes Rate-Limit würde bei jedem
// Lauf reihenweise lebende Jobs archivieren.
const WEG = new Set([404, 410]);

// Die Job-Nummer aus einer karriere.at-Inserats-URL (/jobs/10024392). null, wenn
// der Pfad keine trägt — dann ist die URL entweder eine Suchseite oder ein Format,
// das wir nicht kennen, und wir sagen lieber nichts.
function karriereJobNummer(url: string): string | null {
  return /\/jobs\/(\d+)(?:[/?#]|$)/.exec(url)?.[1] ?? null;
}

// Quellenspezifische Marker, NUR wo sie nachgemessen sind. Was hier fehlt, bekommt
// kein geratenes Muster, sondern 'unbekannt' — siehe checkOnline() unten.
//
// Nachgemessen am 2026-09-04 (je ein echter Request pro Quelle):
//   karriere.at  abgelaufenes Inserat -> HTTP 200, aber Weiterleitung von
//                /jobs/10024392 auf die Suchseite /jobs/wels. Fantasie-ID -> 404.
//                Der Statuscode allein kann tot und lebendig hier also nicht trennen.
//   jobs.at      200 ohne Weiterleitung (lebendes Inserat) — kein Offline-Sample,
//                also kein Marker.
//   linkedin     200 (lebendes Inserat) — kein Offline-Sample, also kein Marker.
//   devjobs.at   429 auf den ersten Request — kein Sample möglich, kein Marker.
//   ams          kein einziger Job im Bestand — nichts zu messen.
const MARKER: Record<string, (res: PageResult, url: string) => OnlineVerdict> = {
  'karriere.at': (res, url) => {
    const nummer = karriereJobNummer(url);
    if (nummer == null) return 'unbekannt';
    // Vergleich über die Job-Nummer statt über die ganze URL: eine angehängte
    // Query oder ein Fragment soll ein lebendes Inserat nicht "offline" machen.
    return karriereJobNummer(res.finalUrl) === nummer ? 'online' : 'offline';
  },
};

// Ein Request pro Aufruf. Der Aufrufer entscheidet, WIE VIELE Jobs er so prüft und
// mit welchen Pausen — diese Funktion drosselt bewusst nicht selbst, sonst gäbe es
// zwei Stellen, die dieselbe Politik behaupten (siehe lib/scrape-runner.ts).
export async function checkOnline(
  job: { source: string; url: string },
  fetcher: PageFetcher = fetchPage,
): Promise<OnlineVerdict> {
  const res = await fetcher(job.url);
  if (WEG.has(res.status)) return 'offline';
  // Alles, was nicht sauber durchkam (429, 5xx, 403, Timeout mit status 0), ist keine
  // Aussage über das Inserat, sondern eine über die Verbindung.
  if (!res.ok) return 'unbekannt';
  return MARKER[job.source]?.(res, job.url) ?? 'unbekannt';
}
