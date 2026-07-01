import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { judgeJob, parseJudgment } from '../lib/filter-llm.ts';

const VALID = '{"it_rolle":"ja","erfahrung_ab_3j_erforderlich":"nein","lehre_coding":"n/a","junior_signal":"ja"}';

test('parseJudgment: gültiges JSON mit allen vier Keys', () => {
  assert.deepEqual(parseJudgment(VALID), {
    it_rolle: 'ja',
    erfahrung_ab_3j_erforderlich: 'nein',
    lehre_coding: 'n/a',
    junior_signal: 'ja',
  });
});

test('parseJudgment: fehlender Key → null', () => {
  assert.equal(parseJudgment('{"it_rolle":"ja"}'), null);
});

test('parseJudgment: ungültiger Wert → null', () => {
  assert.equal(parseJudgment('{"it_rolle":"vielleicht","erfahrung_ab_3j_erforderlich":"nein","lehre_coding":"n/a","junior_signal":"ja"}'), null);
});

test('parseJudgment: kein JSON → null', () => {
  assert.equal(parseJudgment('kein json'), null);
});

function mockChatSequence(contents: string[]): Promise<{ url: string; close: () => void; calls: () => number }> {
  let i = 0;
  let count = 0;
  return new Promise(resolve => {
    const server = createServer((_, res) => {
      count++;
      const content = contents[Math.min(i, contents.length - 1)];
      i++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { role: 'assistant', content } }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), calls: () => count });
    });
  });
}

test('judgeJob: gültige Antwort → sofort zurück, 1 Call', async (t) => {
  const { url, close, calls } = await mockChatSequence([VALID]);
  t.after(close);
  assert.deepEqual(await judgeJob('input', false, url), {
    it_rolle: 'ja',
    erfahrung_ab_3j_erforderlich: 'nein',
    lehre_coding: 'n/a',
    junior_signal: 'ja',
  });
  assert.equal(calls(), 1);
});

test('judgeJob: 1. Call Müll, 2. Call gültig → Retry greift', async (t) => {
  const { url, close, calls } = await mockChatSequence(['kein json', VALID]);
  t.after(close);
  const result = await judgeJob('input', false, url);
  assert.notEqual(result, null);
  assert.equal(calls(), 2);
});

test('judgeJob: 2× Müll → null (kein hartes Urteil erraten)', async (t) => {
  const { url, close, calls } = await mockChatSequence(['Müll 1', 'Müll 2']);
  t.after(close);
  assert.equal(await judgeJob('input', false, url), null);
  assert.equal(calls(), 2);
});

test('judgeJob: Netzwerkfehler (kein Server) → null', async () => {
  assert.equal(await judgeJob('input', false, 'http://127.0.0.1:1'), null);
});
