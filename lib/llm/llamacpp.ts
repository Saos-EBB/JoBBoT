import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { config } from '../../config.ts';
import { openAiChat } from './openai-compat.ts';
import { ensureLocalServer, probe } from './local-server.ts';
import type { CheckResult, LlmProvider, ModelPair } from './types.ts';

// llama.cpp (`llama-server`) im Router-Modus: EIN Server, Modelle werden pro Request
// über den Modellnamen geladen (Presets in config/llama-models.ini, gestartet von
// scripts/llama-server.sh mit --models-max 1 → nie zwei große Modelle zugleich im RAM).
// Der Modellname ist der Preset-Name, z. B. "gemma4-26b" (Vulkan/iGPU) oder
// "gemma4-26b-cpu" — CPU vs. Vulkan ist damit nur ein anderer Name.
//
// Threads, Kontextgröße und GPU-Offload sind Startparameter des Modellprozesses
// (Preset), nicht pro Request.

export function resolveLlamaModels(): ModelPair {
  return { filter: config.llamacppModelNimble, writer: config.llamacppModelWriter };
}

const isUp = (host: string) => probe(`${host}/health`);

// Startet scripts/llama-server.sh losgelöst (überlebt den Bot).
// Ausgabe nach data/llama-server.log, sonst ginge sie mit stdio:'ignore' verloren.
function startLocalLlamaServer(): void {
  const log = openSync('data/llama-server.log', 'a');
  spawn('bash', ['scripts/llama-server.sh'], { detached: true, stdio: ['ignore', log, log] })
    .on('error', () => {})
    .unref();
}

export async function ensureLlamaServer(
  host = config.llamacppHost,
  { start = startLocalLlamaServer, timeoutMs = 30_000 }: { start?: () => void; timeoutMs?: number } = {},
): Promise<void> {
  return ensureLocalServer({ label: 'llama-server', host, isUp, start, timeoutMs, statusHint: 'Log: data/llama-server.log' });
}

// Router-Modus: /v1/models listet alle Presets (geladen oder nicht) — "da" heißt hier
// "als Preset bekannt", nicht "im RAM".
export async function checkLlamaServer(host = config.llamacppHost, models: ModelPair = resolveLlamaModels()): Promise<CheckResult> {
  const needed = [...new Set([models.filter, models.writer])];
  try {
    const res = await fetch(`${host}/v1/models`);
    const data = await res.json() as { data: { id: string }[] };
    const found = data.data.map(m => m.id);
    const missing = needed.filter(n => !found.includes(n));
    return { ok: missing.length === 0, found, missing };
  } catch {
    return { ok: false, found: [], missing: needed };
  }
}

export const llamacppProvider: LlmProvider = {
  name: 'llamacpp',
  resolveModels: () => resolveLlamaModels(),
  chat: req => {
    // think → enable_thinking im Chat-Template (Qwen3, Gemma 4, …); Templates ohne die
    // Variable ignorieren sie. Ohne das denkt ein Reasoning-Modell erst minutenlang
    // versteckt, bevor der erste Content-Token kommt.
    const extra = req.think === undefined ? {} : { chat_template_kwargs: { enable_thinking: req.think } };
    return openAiChat(req.host ?? config.llamacppHost, req, extra);
  },
  ensureReady: host => ensureLlamaServer(host),
  check: (host, models) => checkLlamaServer(host, models),
  missingHint: model => `Preset [${model}] in config/llama-models.ini anlegen, GGUF nach ~/.local/share/llama-models`,
  unload: async (model, host = config.llamacppHost) => {
    await fetch(`${host}/models/unload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    }).catch(() => {});
  },
};
