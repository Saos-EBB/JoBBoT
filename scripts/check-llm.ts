import { getProvider } from '../lib/llm/index.ts';

const llm = getProvider();
const models = llm.resolveModels();
// Erst hochfahren (wie jeder echte Lauf): nach einem Neustart läuft llama-server nicht,
// und check() kann "Server weg" nicht von "Modell fehlt" unterscheiden.
try {
  await llm.ensureReady();
} catch (err) {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
}
const result = await llm.check(undefined, models);

if (result.ok) {
  console.log(`✓ ${llm.name} erreichbar, beide Modelle da: ${models.filter}, ${models.writer}`);
} else {
  for (const m of result.missing) {
    console.error(`✗ ${llm.name}: Fehlt: ${m} — hol es mit: ${llm.missingHint(m)}`);
  }
  process.exit(1);
}
