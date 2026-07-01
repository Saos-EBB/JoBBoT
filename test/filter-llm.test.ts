import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { askClearYesNo, parseVerdict } from '../lib/filter-llm.ts';

test('parseVerdict: "ja"/"nein"/"unsicher" korrekt, sonst null', () => {
  assert.equal(parseVerdict('{"antwort":"ja"}'), 'ja');
  assert.equal(parseVerdict('{"antwort":"nein"}'), 'nein');
  assert.equal(parseVerdict('{"antwort":"unsicher"}'), 'unsicher');
  assert.equal(parseVerdict('{"antwort":"vielleicht"}'), null);
  assert.equal(parseVerdict('kein json'), null);
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

test('askClearYesNo: gültige Antwort → sofort zurück, 1 Call', async (t) => {
  const { url, close, calls } = await mockChatSequence(['{"antwort":"ja"}']);
  t.after(close);
  assert.equal(await askClearYesNo('frage?', 'input', url), 'ja');
  assert.equal(calls(), 1);
});

test('askClearYesNo: 1. Call Müll, 2. Call gültig → Retry greift', async (t) => {
  const { url, close, calls } = await mockChatSequence(['kein json', '{"antwort":"nein"}']);
  t.after(close);
  assert.equal(await askClearYesNo('frage?', 'input', url), 'nein');
  assert.equal(calls(), 2);
});

test('askClearYesNo: 2× Müll → "unsicher" (nie hart ablehnen)', async (t) => {
  const { url, close, calls } = await mockChatSequence(['Müll 1', 'Müll 2']);
  t.after(close);
  assert.equal(await askClearYesNo('frage?', 'input', url), 'unsicher');
  assert.equal(calls(), 2);
});

test('askClearYesNo: Netzwerkfehler (kein Server) → "unsicher"', async () => {
  assert.equal(await askClearYesNo('frage?', 'input', 'http://127.0.0.1:1'), 'unsicher');
});
