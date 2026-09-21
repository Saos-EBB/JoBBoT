import { spawn, spawnSync } from 'node:child_process';
import { config } from '../config.ts';
import { loadSettings } from './settings.ts';

// Die eine Stelle, die sagt, WELCHE Modelle der Lauf tatsächlich benutzt.
// Der Filter läuft gegen loadSettings().filterModel (config/settings.json), NICHT
// gegen config.modelFilter (env JOBBOT_MODEL_FILTER) — die beiden konnten
// auseinanderlaufen, sodass checkOllama grün meldete, während der Filter ein ganz
// anderes Modell zog. checkOllama prüft jetzt dasselbe Modell, das der Filter zieht.
export function resolveModels(configDir?: string): { filter: string; writer: string } {
  return { filter: loadSettings(configDir).filterModel, writer: config.modelWriter };
}

export async function checkOllama(
  host = config.ollamaHost,
  models: { filter: string; writer: string } = resolveModels(),
): Promise<{ ok: boolean; found: string[]; missing: string[] }> {
  const needed = [models.filter, models.writer];
  try {
    const res = await fetch(`${host}/api/tags`);
    const data = await res.json() as { models: { name: string }[] };
    const names: string[] = data.models.map(m => m.name);
    const missing = needed.filter(n => !names.some(found => found.startsWith(n)));
    return { ok: missing.length === 0, found: names, missing };
  } catch {
    return { ok: false, found: [], missing: needed };
  }
}

async function isUp(host: string): Promise<boolean> {
  try {
    return (await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

// Bevorzugt den systemd-User-Dienst (überlebt den Bot, wird von systemd überwacht),
// fällt auf einen losgelösten `ollama serve` zurück, wenn es den Dienst nicht gibt.
function startLocalOllama(): void {
  const r = spawnSync('systemctl', ['--user', 'start', 'ollama'], { timeout: 10_000 });
  if (r.status === 0) return;
  // 'error'-Handler nötig: fehlt das Binary, wird sonst ein unbehandeltes Event zum Absturz.
  spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// Stellt vor einem LLM-Lauf sicher, dass Ollama antwortet — startet es bei Bedarf selbst
// (nur für lokale Hosts) und wartet, bis es erreichbar ist. Wirft mit klarer Meldung statt
// später mit einem kryptischen "fetch failed". Der gestartete Server bleibt absichtlich
// laufen (er entlädt das Modell selbst nach keep_alive, Default 5 min).
export async function ensureOllama(
  host = config.ollamaHost,
  { start = startLocalOllama, timeoutMs = 30_000 }: { start?: () => void; timeoutMs?: number } = {},
): Promise<void> {
  if (await isUp(host)) return;
  const { hostname } = new URL(host);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(`Ollama unter ${host} nicht erreichbar (Remote-Host, kein Autostart)`);
  }
  start();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    if (await isUp(host)) return;
  }
  throw new Error(`Ollama nicht erreichbar: ${host} — Start versucht, keine Antwort nach ${Math.round(timeoutMs / 1000)}s (systemctl --user status ollama)`);
}

// Ollama streamt bei stream:true NDJSON (ein JSON-Objekt pro Zeile). Konkateniert
// die message.content-Fragmente zum vollständigen Text. Wohnte vorher in
// lib/anschreiben.ts — gehört zum Ollama-Client, nicht zum Anschreiben-Schreiber.
export async function readNdjsonContent(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const chunk = JSON.parse(trimmed) as { message?: { content?: string } };
    content += chunk?.message?.content ?? '';
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      consumeLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) consumeLine(buffer);

  return content;
}

// Der eine Ollama-Chat-Client. Vorher rollte jeder Aufrufer (filter-llm.ts,
// anschreiben.ts, der Modell-Bench) den fetch auf /api/chat samt Body-Form,
// stream-vs-json-Auslesung und Fehlerbehandlung selbst nach. chat() besitzt jetzt
// den Transport; Retry/Regenerierung bleiben beim Aufrufer, weil sie parse-spezifisch
// sind (recall-sicheres null beim Filter, Absatz-Regenerierung beim Anschreiben).
//
// Wirft bei Netzwerkfehler und bei nicht-2xx-Status — der Aufrufer entscheidet, ob das
// ein null-Urteil (Filter) oder einen weiteren Versuch (Anschreiben) bedeutet.
export interface ChatRequest {
  model: string;
  messages: { role: string; content: string }[];
  // Default false → eine JSON-Antwort. true → NDJSON-Stream (Ollama schickt sofort
  // Header, nötig bei langsamen/großen Modellen gegen undicis headersTimeout).
  stream?: boolean;
  format?: 'json';
  // think:false unterdrückt den versteckten Reasoning-Anteil bei qwen3-Modellen;
  // bei gemma/mistral wirkungslos, aber kein Fehler.
  think?: boolean;
  options?: Record<string, unknown>;
  signal?: AbortSignal;
  host?: string;
}

export async function chat(req: ChatRequest): Promise<string> {
  const { host = config.ollamaHost, model, messages, stream = false, format, think, options, signal } = req;
  const body: Record<string, unknown> = { model, messages, stream };
  if (format) body.format = format;
  if (think !== undefined) body.think = think;
  if (options) body.options = options;

  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`ollama /api/chat ${res.status}`);

  if (stream) return readNdjsonContent(res);
  const data = await res.json() as { message?: { content?: string } };
  return data?.message?.content ?? '';
}
