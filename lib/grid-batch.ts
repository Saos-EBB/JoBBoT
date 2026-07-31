// Gemeinsamer Batch-Sammler für Scraper ohne echte Suchergebnis-Pagination
// (karriere.at, jobs.at) — gruppiert den Job-für-Job-Detail-Abruf in feste
// Blöcke, damit onUnitDone dieselbe "eine Zeile pro Einheit"-Semantik wie
// die echten Pagination-Quellen bekommt (siehe scrapers/interface.ts).
export function createBatcher<T>(size: number, onUnitDone?: (items: T[]) => void) {
  let buffer: T[] = [];
  function flush(): void {
    if (buffer.length === 0) return;
    onUnitDone?.(buffer);
    buffer = [];
  }
  function push(item: T): void {
    buffer.push(item);
    if (buffer.length >= size) flush();
  }
  return { push, flush };
}
