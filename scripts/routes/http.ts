import type { IncomingMessage, ServerResponse } from 'node:http';

// Die Fehlerform, die praktisch jede Route auf einem catch-Zweig sendet — an einer
// Stelle benannt, statt dass jeder UI-Hook sie einzeln von Hand nachtippt.
export type ErrorResponse = { error: string };

export function respondJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// Wirft wie ein rohes JSON.parse() auf ungültigem Body — Aufrufer, die das bisher mit
// eigenem try/catch abfangen (z.B. für einen Default-Wert), tun das weiterhin selbst.
export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body) as T;
}
