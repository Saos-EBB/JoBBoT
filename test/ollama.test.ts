import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkOllama } from '../lib/ollama.ts';
import { mockOllama } from './helpers.ts';

const FILTER = 'qwen2.5:3b';
const WRITER = 'qwen2.5:7b';

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

test('startsWith match: "qwen2.5:3b-instruct" counts for "qwen2.5:3b"', async (t) => {
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

test('server not reachable → ok:false, no throw', async (t) => {
  // grab a port then close it so nothing listens there
  const srv = createServer(() => {});
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as AddressInfo;
  await new Promise<void>(r => srv.close(r));

  const result = await checkOllama(`http://127.0.0.1:${port}`);
  assert.equal(result.ok, false);
});
