import type { ServerResponse } from 'node:http';

// SSE statt Polling fürs Lade-Grid: der Server ist plain node:http ohne Build-Step,
// SSE braucht dafür nur einen offen gehaltenen Response-Stream (kein zusätzliches
// Protokoll/Library) — einfacher als Chunked-Transfer selbst zu parsen. Die
// vorhandene /status-Route bleibt für den restlichen (i/total-)Zustand nutzbar.
// Payload ist jetzt "Einheit fertig + ihre Items" statt Prozent-/Phasen-Fortschritt —
// ein Event pro abgeschlossener Zeile (Seite/Batch/Anschreiben-Item), das Frontend
// hängt die Zeile an (siehe ui/app.tsx LoadGrid). Kein Snapshot beim (Re-)Connect —
// Einzelnutzer-Lokaltool, ein mittendrin verbundener Client sieht nur ab da (siehe
// scrapeRun/filterRun/anschreibenRun: ein Server-Neustart verliert genauso).
export interface GridSquare { id: string; tooltip: string; state: 'done' | 'error' | 'excluded' | 'matched' | 'offstack' | 'brutal'; url?: string }
export interface GridUnitEvent { section: string; sectionLabel: string; row: string; items: GridSquare[] }

export function createSseChannel<T>() {
  const clients = new Set<ServerResponse>();
  function broadcast(payload: T): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) client.write(data);
  }
  return { clients, broadcast };
}
