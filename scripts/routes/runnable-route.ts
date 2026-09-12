import type { ServerResponse } from 'node:http';
import { respondJson } from './http.ts';

interface RunHandle<TResult> {
  start(): string | null;
  succeed(result: TResult, status?: 'done' | 'stopped'): void;
  fail(err: unknown): void;
}

// Zentralisiert das HTTP-Wrapping um einen RunState-Lauf (Lock+409, sofortige
// 200-Antwort, try/catch um succeed/fail, defensiver Body-Parse) — vorher in
// scrape.ts, filter.ts und anschreiben.ts je einzeln nachgebaut. Was wirklich
// pro Route variiert (Fortschritts-Form, SSE-Granularität, die eigentliche
// Arbeit) bleibt beim Aufrufer.

// Lock synchron VOR dem ersten await setzen (der Body-Read ist async) — sonst
// könnten zwei fast gleichzeitige POSTs beide noch den alten Status sehen und
// beide einen Lauf starten (TOCTOU). Antwort geht sofort raus; der Rest läuft
// im Hintergrund weiter (Fire-and-Poll, siehe GET .../status).
export function beginRun<TResult>(res: ServerResponse, run: RunHandle<TResult>, onStart: () => void): string | null {
  const runId = run.start();
  if (!runId) {
    respondJson(res, 409, { started: false, reason: 'already-running' });
    return null;
  }
  onStart();
  respondJson(res, 200, { started: true, runId });
  return runId;
}

export async function finishRun<TResult>(
  run: RunHandle<TResult>,
  work: () => Promise<{ result: TResult; status?: 'done' | 'stopped' }>,
): Promise<void> {
  try {
    const { result, status } = await work();
    run.succeed(result, status);
  } catch (err) {
    run.fail(err);
  }
}

// Body ist optional bzw. kann fehlerhaft sein (fehlender Header, kaputtes JSON) —
// alle drei Routen behandelten das bisher gleich: leer/Standard statt eines
// Fehlers, weil "keine Auswahl getroffen" kein Serverfehler ist.
export async function parseBodyOrDefault<T>(parse: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await parse();
  } catch {
    return fallback;
  }
}
