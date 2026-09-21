import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { checkOllama, ensureOllama, resolveModels } from '../lib/ollama.ts';
import { config } from '../config.ts';
import { mockOllama, tmpDir, rmTmp } from './helpers.ts';

const FILTER = 'qwen3.5:9b';
const WRITER = 'mistral-small3.2:latest';

test('both models present → ok:true, missing:[]', async (t) => {
  const mock = await mockOllama([FILTER, WRITER]);
  t.after(mock.close);
  const result = await checkOllama(mock.url);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('one model missing → ok:false, missing contains it', async (t) => {
  const mock = await mockOllama([FILTER]);
  t.after(mock.close);
  const result = await checkOllama(mock.url);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes(WRITER));
  assert.ok(result.found.includes(FILTER));
});

test('startsWith match: "qwen3.5:9b-instruct" counts for "qwen3.5:9b"', async (t) => {
  const mock = await mockOllama([`${FILTER}-instruct`, WRITER]);
  t.after(mock.close);
  const result = await checkOllama(mock.url);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('models:[] → both missing, ok:false', async (t) => {
  const mock = await mockOllama([]);
  t.after(mock.close);
  const result = await checkOllama(mock.url);
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 2);
});

test('server returns 500 → ok:false, no throw', async (t) => {
  const server = createServer((_, res) => { res.writeHead(500); res.end('error'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const result = await checkOllama(`http://127.0.0.1:${port}`);
  assert.equal(result.ok, false);
});

test('server returns broken JSON → ok:false, no throw', async (t) => {
  const server = createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{{{not json');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const result = await checkOllama(`http://127.0.0.1:${port}`);
  assert.equal(result.ok, false);
});

test('resolveModels: Filter-Modell kommt aus settings.json, nicht aus env', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ filterMode: 'llm', filterModel: 'llama3:70b' }));
  const { filter, writer } = resolveModels(dir);
  assert.equal(filter, 'llama3:70b');
  assert.equal(writer, config.modelWriter);
});

test('checkOllama: prüft das laufende Filter-Modell (grün nur, wenn DAS vorhanden ist)', async (t) => {
  // Writer vorhanden, das in settings gesetzte Filter-Modell fehlt → NICHT grün.
  const mock = await mockOllama([config.modelWriter]);
  t.after(mock.close);
  const result = await checkOllama(mock.url, { filter: 'llama3:70b', writer: config.modelWriter });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('llama3:70b'));
});

test('server not reachable → ok:false, no throw', async (t) => {
  // grab a port then close it so nothing listens there
  const srv = createServer(() => {});
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>(resolve => srv.close(() => resolve()));

  const result = await checkOllama(`http://127.0.0.1:${port}`);
  assert.equal(result.ok, false);
});

test('ensureOllama: läuft schon → start wird nicht aufgerufen', async (t) => {
  const mock = await mockOllama([WRITER]);
  t.after(mock.close);
  let started = false;
  await ensureOllama(mock.url, { start: () => { started = true; } });
  assert.equal(started, false);
});

test('ensureOllama: down → ruft start auf und wartet, bis der Server antwortet', async (t) => {
  // Freien Port reservieren, wieder freigeben (down), start() bindet den Mock dort.
  const probe = await mockOllama([]);
  const url = probe.url;
  probe.close();
  await new Promise(r => setTimeout(r, 50));
  let late: { close: () => void } | undefined;
  t.after(() => late?.close());
  await ensureOllama(url, {
    start: () => {
      const port = Number(new URL(url).port);
      const server = createServer((_, res) => { res.writeHead(200); res.end('{"models":[]}'); });
      server.listen(port, '127.0.0.1');
      late = { close: () => server.close() };
    },
    timeoutMs: 5000,
  });
  assert.ok(late);
});

test('ensureOllama: start bringt nichts hoch → wirft mit klarer Meldung', async () => {
  await assert.rejects(
    ensureOllama('http://127.0.0.1:1', { start: () => {}, timeoutMs: 700 }),
    /Ollama nicht erreichbar/,
  );
});

test('ensureOllama: Remote-Host → kein Autostart, wirft', async () => {
  let started = false;
  await assert.rejects(
    ensureOllama('http://192.0.2.1:11434', { start: () => { started = true; }, timeoutMs: 500 }),
    /Remote-Host/,
  );
  assert.equal(started, false);
});
