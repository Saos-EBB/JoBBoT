import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openAiChat, buildOpenAiBody } from '../lib/llm/openai-compat.ts';
import { llamacppProvider, checkLlamaServer, ensureLlamaServer } from '../lib/llm/llamacpp.ts';

// Ein Server, der den Request festhält und mit `respond` antwortet.
function mockServer(respond: (req: IncomingMessage, body: any, res: ServerResponse) => void): Promise<{ url: string; close: () => void; body: () => any; path: () => string }> {
  return new Promise(resolve => {
    let captured: any = null;
    let path = '';
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        path = req.url ?? '';
        captured = raw ? JSON.parse(raw) : null;
        respond(req, captured, res);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), body: () => captured, path: () => path });
    });
  });
}

const sse = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const msg = [{ role: 'user', content: 'x' }];

test('openAiChat: non-stream → choices[0].message.content', async (t) => {
  const mock = await mockServer((_, __, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'hallo' } }] }));
  });
  t.after(mock.close);
  assert.equal(await openAiChat(mock.url, { model: 'm', messages: msg }), 'hallo');
  assert.equal(mock.path(), '/v1/chat/completions');
});

test('openAiChat: SSE-Stream, Chunks reißen mitten in Zeilen und Umlauten', async (t) => {
  const stream = sse('Grüße ') + ': ping\n\n' + `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'geheim' } }] })}\n\n` + sse('aus ') + sse('Linz') + 'data: [DONE]\n\n';
  const bytes = Buffer.from(stream, 'utf8');
  const mock = await mockServer(async (_, __, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // In 7-Byte-Häppchen schicken: trifft garantiert Zeilenmitten und das "ü" (2 Bytes).
    for (let i = 0; i < bytes.length; i += 7) {
      res.write(bytes.subarray(i, i + 7));
      await new Promise(r => setTimeout(r, 1));
    }
    res.end();
  });
  t.after(mock.close);
  const out = await openAiChat(mock.url, { model: 'm', messages: msg, stream: true });
  assert.equal(out, 'Grüße aus Linz');
});

test('openAiChat: Fehler-Event im Stream → wirft', async (t) => {
  const mock = await mockServer((_, __, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sse('an') + `data: ${JSON.stringify({ error: { message: 'context overflow' } })}\n\n`);
  });
  t.after(mock.close);
  await assert.rejects(openAiChat(mock.url, { model: 'm', messages: msg, stream: true }), /context overflow/);
});

test('openAiChat: non-2xx → wirft mit Status und Servertext', async (t) => {
  const mock = await mockServer((_, __, res) => { res.writeHead(400); res.end('model not found'); });
  t.after(mock.close);
  await assert.rejects(openAiChat(mock.url, { model: 'm', messages: msg }), /400: model not found/);
});

test('buildOpenAiBody: json/temperature gemappt', () => {
  const body = buildOpenAiBody({ model: 'm', messages: msg, json: true, temperature: 0 });
  assert.deepEqual(body, { model: 'm', messages: msg, stream: false, temperature: 0, response_format: { type: 'json_object' } });
});

test('buildOpenAiBody: maxTokens → max_tokens', () => {
  const body = buildOpenAiBody({ model: 'm', messages: msg, maxTokens: 4 });
  assert.equal(body.max_tokens, 4);
});

test('llamacpp-Provider: think:false → chat_template_kwargs.enable_thinking=false', async (t) => {
  const mock = await mockServer((_, __, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  });
  t.after(mock.close);
  await llamacppProvider.chat({ host: mock.url, model: 'gemma4-26b', messages: msg, think: false, json: true });
  assert.deepEqual(mock.body().chat_template_kwargs, { enable_thinking: false });
  assert.equal(mock.body().model, 'gemma4-26b');
});

test('llamacpp-Provider: ohne think kein chat_template_kwargs', async (t) => {
  const mock = await mockServer((_, __, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
  });
  t.after(mock.close);
  await llamacppProvider.chat({ host: mock.url, model: 'm', messages: msg });
  assert.ok(!('chat_template_kwargs' in mock.body()));
});

test('checkLlamaServer: Preset-Liste aus /v1/models, fehlendes Modell gemeldet', async (t) => {
  const mock = await mockServer((_, __, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'gemma4-26b' }, { id: 'gemma4-26b-cpu' }] }));
  });
  t.after(mock.close);
  const ok = await checkLlamaServer(mock.url, { filter: 'gemma4-26b', writer: 'gemma4-26b' });
  assert.deepEqual(ok, { ok: true, found: ['gemma4-26b', 'gemma4-26b-cpu'], missing: [] });
  const bad = await checkLlamaServer(mock.url, { filter: 'gemma4-26b', writer: 'mistral-small3.2' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.missing, ['mistral-small3.2']);
});

test('checkLlamaServer: Server weg → ok:false, kein Wurf', async () => {
  const r = await checkLlamaServer('http://127.0.0.1:1', { filter: 'a', writer: 'b' });
  assert.deepEqual(r, { ok: false, found: [], missing: ['a', 'b'] });
});

test('ensureLlamaServer: läuft (/health 200) → kein Start', async (t) => {
  const mock = await mockServer((_, __, res) => { res.writeHead(200); res.end('{"status":"ok"}'); });
  t.after(mock.close);
  let started = false;
  await ensureLlamaServer(mock.url, { start: () => { started = true; } });
  assert.equal(started, false);
});

test('ensureLlamaServer: down → ruft start auf und wartet, bis der Server antwortet', async (t) => {
  // Freien Port reservieren, wieder freigeben (down), start() bindet den Mock dort.
  const probe = await mockServer((_, __, res) => { res.end(); });
  const url = probe.url;
  probe.close();
  await new Promise(r => setTimeout(r, 50));
  let late: { close: () => void } | undefined;
  t.after(() => late?.close());
  await ensureLlamaServer(url, {
    start: () => {
      const server = createServer((_, res) => { res.writeHead(200); res.end('{"status":"ok"}'); });
      server.listen(Number(new URL(url).port), '127.0.0.1');
      late = { close: () => server.close() };
    },
    timeoutMs: 5000,
  });
  assert.ok(late);
});

test('ensureLlamaServer: start bringt nichts hoch → wirft mit klarer Meldung', async () => {
  await assert.rejects(
    ensureLlamaServer('http://127.0.0.1:1', { start: () => {}, timeoutMs: 700 }),
    /llama-server nicht erreichbar/,
  );
});

test('ensureLlamaServer: Remote-Host → kein Autostart, wirft', async () => {
  let started = false;
  await assert.rejects(
    ensureLlamaServer('http://192.0.2.1:8089', { start: () => { started = true; }, timeoutMs: 500 }),
    /llama-server unter .* nicht erreichbar \(Remote-Host/,
  );
  assert.equal(started, false);
});

test('llamacpp-Provider: unload → POST /models/unload mit Modellname', async (t) => {
  const mock = await mockServer((_, __, res) => { res.writeHead(200); res.end('{"success":true}'); });
  t.after(mock.close);
  await llamacppProvider.unload!('gemma4-26b', mock.url);
  assert.equal(mock.path(), '/models/unload');
  assert.deepEqual(mock.body(), { model: 'gemma4-26b' });
});
