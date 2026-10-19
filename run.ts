import { getProvider } from './lib/llm/index.ts';
import { JsonStore } from './storage/json-store.ts';
import { config } from './config.ts';

console.log('=== JobBot Health ===\n');

// LLM-Backend (JOBBOT_LLM_PROVIDER, Default llamacpp)
const llm = getProvider();
const models = llm.resolveModels();
// Erst hochfahren (wie jeder echte Lauf): nach einem Neustart läuft llama-server nicht,
// und check() kann "Server weg" nicht von "Modell fehlt" unterscheiden.
const down = await llm.ensureReady().then(() => null, (err: Error) => err.message);
const llmCheck = down ? { ok: false, found: [], missing: [] } : await llm.check(undefined, models);
console.log(`LLM (${llm.name}):  ${llmCheck.ok ? '✓' : '✗'}`);
if (down) {
  console.log(`  ✗ ${down}`);
} else if (!llmCheck.ok) {
  for (const m of llmCheck.missing) console.log(`  ✗ Fehlt: ${m} — ${llm.missingHint(m)}`);
} else {
  console.log(`  ✓ ${models.filter}, ${models.writer}`);
}

// Storage self-check
const store = new JsonStore();
const jobs = await store.list();
console.log(`\nStorage: ✓ (${jobs.length} Jobs in ${config.dataDir})`);

console.log('\n' + (llmCheck.ok ? '✓ Bereit.' : down ? `✗ ${llm.name} nicht erreichbar — siehe oben.` : `✗ ${llm.name}-Modelle fehlen — siehe oben.`));
