import { checkOllama } from './lib/ollama.ts';
import { createStorage } from './storage/index.ts';
import { config } from './config.ts';

console.log('=== JobBot Health ===\n');

// Ollama
const ollama = await checkOllama();
console.log(`Ollama:  ${ollama.ok ? '✓' : '✗'}`);
if (!ollama.ok) {
  for (const m of ollama.missing) console.log(`  ✗ Fehlt: ${m} — ollama pull ${m}`);
} else {
  console.log(`  ✓ ${config.modelFilter}, ${config.modelWriter}`);
}

// Storage self-check
const store = createStorage();
const jobs = await store.list();
console.log(`\nStorage: ✓ (${jobs.length} Jobs in ${config.dataDir})`);

console.log('\n' + (ollama.ok ? '✓ Bereit.' : '✗ Ollama-Modelle fehlen — siehe oben.'));
