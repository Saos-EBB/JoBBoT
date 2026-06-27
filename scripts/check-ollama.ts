import { checkOllama } from '../lib/ollama.ts';
import { config } from '../config.ts';

const result = await checkOllama();

if (result.ok) {
  console.log(`✓ Ollama erreichbar, beide Modelle da: ${config.modelFilter}, ${config.modelWriter}`);
} else {
  for (const m of result.missing) {
    console.error(`✗ Fehlt: ${m} — hol es mit: ollama pull ${m}`);
  }
  process.exit(1);
}
