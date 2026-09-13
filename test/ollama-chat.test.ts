import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chat } from '../lib/ollama.ts';
import { mockChat } from './helpers.ts';

// Ein Mock, der den empfangenen Request-Body festhält — für die Prüfung, dass chat()
// format/options/think/stream korrekt in den /api/chat-Body schreibt.
function captureChat(content: string): Promise<{ url: string; close: () => void; body: () => any }> {
  return new Promise(resolve => {
    let captured: any = null;
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        captured = raw ? JSON.parse(raw) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: { role: 'assistant', content } }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), body: () => captured });
    });
  });
}

// Ein Mock, der echtes NDJSON (mehrere Zeilen) streamt — Ollamas stream:true-Form.
function streamChat(fragments: string[]): Promise<{ url: string; close: () => void }> {
  return new Promise(resolve => {
    const server = createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      for (const f of fragments) res.write(JSON.stringify({ message: { content: f } }) + '\n');
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

test('chat: non-stream → message.content', async (t) => {
  const mock = await mockChat('hallo welt');
  t.after(mock.close);
  const out = await chat({ host: mock.url, model: 'm', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(out, 'hallo welt');
});

test('chat: stream:true → NDJSON-Fragmente konkateniert', async (t) => {
  const mock = await streamChat(['Guten ', 'Tag ', 'Welt']);
  t.after(mock.close);
  const out = await chat({ host: mock.url, model: 'm', messages: [{ role: 'user', content: 'x' }], stream: true });
  assert.equal(out, 'Guten Tag Welt');
});

test('chat: schreibt format/options/think/stream in den Body', async (t) => {
  const mock = await captureChat('{}');
  t.after(mock.close);
  await chat({
    host: mock.url,
    model: 'mymodel',
    messages: [{ role: 'user', content: 'x' }],
    format: 'json',
    think: false,
    options: { temperature: 0, num_ctx: 4096 },
  });
  const body = mock.body();
  assert.equal(body.model, 'mymodel');
  assert.equal(body.format, 'json');
  assert.equal(body.think, false);
  assert.equal(body.stream, false);
  assert.deepEqual(body.options, { temperature: 0, num_ctx: 4096 });
});

test('chat: lässt format/think/options weg, wenn nicht gesetzt', async (t) => {
  const mock = await captureChat('{}');
  t.after(mock.close);
  await chat({ host: mock.url, model: 'm', messages: [{ role: 'user', content: 'x' }] });
  const body = mock.body();
  assert.ok(!('format' in body));
  assert.ok(!('think' in body));
  assert.ok(!('options' in body));
});

test('chat: non-2xx → wirft', async (t) => {
  const server = createServer((_, res) => { res.writeHead(500); res.end('boom'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  await assert.rejects(
    () => chat({ host: `http://127.0.0.1:${port}`, model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    /500/,
  );
});

test('chat: Netzwerkfehler → wirft', async () => {
  await assert.rejects(
    () => chat({ host: 'http://127.0.0.1:1', model: 'm', messages: [{ role: 'user', content: 'x' }] }),
  );
});

test('chat: abgebrochenes signal → wirft', async (t) => {
  const mock = await mockChat('spät');
  t.after(mock.close);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => chat({ host: mock.url, model: 'm', messages: [{ role: 'user', content: 'x' }], signal: controller.signal }),
  );
});
