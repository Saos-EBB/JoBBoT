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
