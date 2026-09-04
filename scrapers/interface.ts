// Pipeline-Zone (Scraper/Filter/Anschreiben) — nur von lib/filter-decide.ts und
// lib/anschreiben.ts geschrieben, hier unangetastet. UI-Zone — nur vom UI geschrieben
// (bisher scripts/ui-server.ts, komplett ersetzt); literal umbenannt statt derived,
// weil kein anderer Code diese Werte je schreibt.
// "triaged" ersetzt die vormals getrennten filtered_out/uncertain/matched — das Urteil
// selbst lebt jetzt ausschließlich in `fit` (einheitliches Vokabular, kein zweites Feld
// das dieselbe Aussage in anderen Worten trifft).
// "offline" gehört zur Pipeline-Zone: gesetzt von lib/scrape-runner.ts, wenn ein
// gespeichertes Inserat beim Scrapen nachweislich nicht mehr online steht (siehe
// lib/offline-check.ts). Kein eigener Ordner im Storage nötig — wie geloescht/fehler
// bleibt die Datei im Basisordner liegen, JsonStore.dirFor() sortiert ohnehin nur
// "triaged" nach fit ein. Der Weg zurück ist offen: taucht das Inserat wieder auf,
// setzt derselbe Lauf den Status zurück.
export type JobStatus =
  | 'new' | 'triaged' | 'generated'
  | 'freigegeben' | 'postausgang' | 'gesendet' | 'geloescht' | 'fehler' | 'offline';

export type Fit = 'matched' | 'offstack' | 'brutal';

export interface ScrapedJob {
  source: string;
  url: string;
  title: string;
  company: string;
  location?: string;
  description: string;
  postedAt?: string | null;
  salary?: string | null;
}

export interface Job extends ScrapedJob {
  id: string;
  status: JobStatus;
  fit: Fit | null;
  scrapedAt: string;
  updatedAt: string;
  email?: string | null;
  // Nur der Status "fehler" verweist hierauf. Noch niemand schreibt dieses Feld — der
  // Runner-Umbau in run-anschreiben.ts/den Mail-Handlern ist ein separater Auftrag
  // (siehe findings/HANDOFF-gmail-versand.md). Bis dahin ist es ehrlich immer leer.
  error?: string | null;
  // Kein eigener JobStatus-Wert: storage.updateStatus() beschränkt auf ein festes Enum
  // und treibt darüber die Ordner-Verschiebung (lib/folders.ts) — eine Antwort ändert
  // den Bewerbungsstatus nicht, sie ist nur eine zusätzliche Information dazu. Gesetzt
  // über das generische storage.update(), wie job.email.
  replyReceivedAt?: string | null;
  // Jeder Nachfass zu dieser Bewerbung, ältester zuerst. Trägt sowohl die Uhr für den
  // nächsten fälligen Nachfass (lib/followup.ts rechnet ab dem letzten Eintrag, sonst ab
  // sentAt) als auch die Historie fürs UI. 'draft' zählt bewusst mit: ein angelegter
  // Gmail-Entwurf ist "erledigt für jetzt", sonst schlüge derselbe Job beim nächsten
  // Blick wieder auf und bekäme einen zweiten Entwurf.
  followUps?: { at: string; via: 'draft' | 'sent' }[];
  // Zeitpunkt des Übergangs zu status "gesendet", gesetzt an der Sendestelle selbst
  // statt aus updatedAt abgeleitet — updatedAt wird bei jedem storage.update() neu
  // gesetzt (z.B. wenn später replyReceivedAt eintrifft) und wäre danach kein
  // verlässliches Sende-Datum mehr. Altbestand ohne sentAt bleibt bewusst undatiert.
  sentAt?: string | null;
}

// Wie eine Suchanfrage in config/sources.json aussieht. Bleibt bewusst ein loser
// Record: das ist die Form, in der die Datei geparst ankommt, und ein Schema-Typ hier
// würde nur vortäuschen, dass die Datei geprüft wäre. Geprüft wird sie gegen
// querySchema (siehe lib/query-schema.ts) — an der Grenze, nicht im Typsystem.
export type SourceQuery = Record<string, string>;

// Format eines einzelnen Feldes. Für die Einstellungsseite gedacht: sie muss wissen,
// wie eine Eingabe zu behandeln ist, bevor sie in der Datei landet.
//   'slug'   — wird als URL-Pfadsegment benutzt (karriere.at, jobs.at). searchSlug()
//              normalisiert beim Abruf; das Portal selbst ist gegenüber Umlauten
//              gleichgültig (nachgemessen), die Normalisierung dient der Einheitlichkeit.
//   'text'   — geht wörtlich in einen Query-Parameter (linkedin, ams). Ein hier
//              eingetragener Slug würde wörtlich mit Bindestrichen gesucht.
//   'number' — Zahl als String (ams vicinity, in km).
//   'raw'    — fertiger Query-String, wird unverändert angehängt (devjobs.at).
export type QueryFieldFormat = 'slug' | 'text' | 'number' | 'raw';

export interface QueryField {
  key: string;
  label: string;
  required: boolean;
  format: QueryFieldFormat;
  placeholder?: string;
}

export interface ScraperAdapter {
  name: string;
  kind: 'fetch' | 'browser';
  // Welche Felder eine Suchanfrage dieses Portals haben darf. Pflichtfeld, damit ein
  // Adapter ohne Schema gar nicht erst compiliert — die Einstellungsseite baut ihr
  // Formular daraus, und lib/query-schema.ts prüft die Datei dagegen.
  querySchema: QueryField[];
  scrape(
    queries: SourceQuery[],
    keep?: (job: ScrapedJob) => boolean,
    onProgress?: (current: number, total: number) => void,
    // Fürs Lade-Grid im UI (siehe ui/app.tsx LoadGrid): eine abgeschlossene Zeile
    // fertig gefundener Stellen. Bei Quellen mit echter Suchergebnis-Pagination
    // (devjobs.at, ams, linkedin) ist das eine Seite; bei den übrigen (karriere.at,
    // jobs.at, ohne echte Pagination) ein fester Batch aus dem Detail-Abruf
    // (siehe lib/grid-batch.ts). Titel/Firma/Ort sind zu diesem Zeitpunkt schon
    // bekannt (aus dem Such-Parse), unabhängig vom späteren Detail-Fetch.
    onUnitDone?: (items: ScrapedJob[]) => void,
  ): Promise<ScrapedJob[]>;
}
