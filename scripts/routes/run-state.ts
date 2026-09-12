import { randomUUID } from 'node:crypto';

export interface RunSnapshot<TResult> {
  status: 'idle' | 'running' | 'done' | 'error' | 'stopped';
  runId: string | null;
  result?: TResult;
  error?: string;
}

// Zentralisiert Lauf-Zustand, Lock und randomUUID — vorher in scrape.ts, filter.ts
// und anschreiben.ts je einzeln nachgebaut (idle/running/done/error[/stopped],
// runId, 409 bei doppeltem Start). Der laufspezifische Fortschritt ("current"/
// "sources") bleibt bewusst beim Aufrufer: seine Form unterscheidet sich pro Route
// (Scrape führt eine Map pro Quelle, Filter/Anschreiben ein einzelnes {i,total,title})
// und gehört nicht in diesen gemeinsamen Kern.
export function createRunState<TResult>() {
  let snapshot: RunSnapshot<TResult> = { status: 'idle', runId: null };

  return {
    isRunning(): boolean {
      return snapshot.status === 'running';
    },
    // null, wenn schon ein Lauf läuft — der Aufrufer meldet dann 409. Synchron, damit
    // der Lock vor dem ersten await im Aufrufer steht (TOCTOU-sicher).
    start(): string | null {
      if (snapshot.status === 'running') return null;
      const runId = randomUUID();
      snapshot = { status: 'running', runId };
      return runId;
    },
    succeed(result: TResult, status: 'done' | 'stopped' = 'done'): void {
      snapshot = { status, runId: snapshot.runId, result };
    },
    fail(err: unknown): void {
      snapshot = { status: 'error', runId: snapshot.runId, error: err instanceof Error ? err.message : String(err) };
    },
    get(): RunSnapshot<TResult> {
      return snapshot;
    },
  };
}
