import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'jobbot-test-'));
}

export async function rmTmp(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch { /* already gone */ }
}

// Antwortet wie llama-server auf /v1/chat/completions: bei stream:true als SSE (ein
// Chunk + [DONE]), sonst als JSON mit choices[0].message.content.
function answer(req: IncomingMessage, res: ServerResponse, content: string): void {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const stream = raw ? JSON.parse(raw).stream === true : false;
    if (stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    }
  });
}

// Ein einzelner Chat-Mock — gebraucht von test/filter.test.ts und test/anschreiben.test.ts.
export function mockChat(content: string, onCall?: () => void): Promise<{ url: string; close: () => void }> {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      onCall?.();
      answer(req, res, content);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

// Liefert pro Aufruf die nächste Antwort aus `contents` (bleibt auf der letzten, wenn
// erschöpft) — für Tests, die einen Regenerierungs-/Retry-Ablauf über mehrere LLM-
// Antworten hinweg prüfen.
export function mockChatSequence(contents: string[]): Promise<{ url: string; close: () => void; calls: () => number }> {
  return new Promise(resolve => {
    let n = 0;
    const server = createServer((req, res) => {
      const content = contents[Math.min(n, contents.length - 1)];
      n++;
      answer(req, res, content);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), calls: () => n });
    });
  });
}

// Absichtlich KEIN sampleJob()/toJob()-Fixture-Builder hier: mindestens 12 Testdateien
// bauen sich ihren Job derzeit von Hand, jede mit leicht anderer Form (manche nehmen
// einen title-Parameter, manche title+description, manche keinen). Das auf einen
// gemeinsamen Builder zu ziehen ist ein eigenes Vorhaben, keine Nebenwirkung dieses
// Commits — jede Vereinheitlichung ist hier eine Verhaltensentscheidung pro Aufrufer.
