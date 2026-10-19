import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider } from '../lib/llm/index.ts';
import { config } from '../config.ts';

test('getProvider: ohne Angabe → das in config gewählte Backend (Default llamacpp)', () => {
  assert.equal(getProvider().name, config.llmProvider);
  assert.equal(getProvider('llamacpp').name, 'llamacpp');
});

test('getProvider: unbekannter Name → wirft mit Liste der bekannten Provider', () => {
  assert.throws(() => getProvider('lamacpp'), /Unbekannter LLM-Provider "lamacpp".*llamacpp/);
});

test('llamacpp-Provider: resolveModels liefert Filter- und Writer-Modell aus config', () => {
  const { filter, writer } = getProvider('llamacpp').resolveModels();
  assert.equal(filter, config.llamacppModelNimble);
  assert.equal(writer, config.llamacppModelWriter);
});
