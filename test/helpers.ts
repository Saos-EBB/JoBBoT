import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'jobbot-test-'));
}

export async function rmTmp(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch { /* already gone */ }
}

export function mockOllama(models: string[]): Promise<{ url: string; close: () => void }> {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: models.map(name => ({ name })) }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

// Ein einzelner /api/chat-Mock — vorher fast identisch in test/filter-llm.test.ts UND
// test/anschreiben.test.ts nachgebaut (beide brauchen einen Ollama-Chat-Endpunkt, keinen
// Modell-Tags-Endpunkt wie mockOllama oben).
export function mockChat(content: string, onCall?: () => void): Promise<{ url: string; close: () => void }> {
  return new Promise(resolve => {
    const server = createServer((_, res) => {
      onCall?.();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

// Liefert pro Aufruf die nächste Antwort aus `contents` (bleibt auf der letzten, wenn
// erschöpft) — für Tests, die einen Regenerierungs-/Retry-Ablauf über mehrere Ollama-
// Antworten hinweg prüfen.
export function mockChatSequence(contents: string[]): Promise<{ url: string; close: () => void; calls: () => number }> {
  return new Promise(resolve => {
    let n = 0;
    const server = createServer((_, res) => {
      const content = contents[Math.min(n, contents.length - 1)];
      n++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content } }));
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
