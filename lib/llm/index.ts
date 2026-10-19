import { config } from '../../config.ts';
import { llamacppProvider } from './llamacpp.ts';
import type { LlmProvider } from './types.ts';

export type { ChatMessage, ChatRequest, CheckResult, LlmProvider, ModelPair } from './types.ts';

// Alle bekannten Backends. Ein neues Backend = eine Datei in lib/llm/ plus ein Eintrag hier.
const PROVIDERS: Record<string, LlmProvider> = {
  llamacpp: llamacppProvider,
};

// Das Backend für diesen Prozess, gewählt über JOBBOT_LLM_PROVIDER (Default llamacpp).
// Ein Tippfehler in der env soll laut scheitern, nicht still auf den Default zurückfallen.
export function getProvider(name: string = config.llmProvider): LlmProvider {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unbekannter LLM-Provider "${name}" (JOBBOT_LLM_PROVIDER) — bekannt: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}
