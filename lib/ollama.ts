import { config } from '../config.ts';

export async function checkOllama(host = config.ollamaHost): Promise<{ ok: boolean; found: string[]; missing: string[] }> {
  try {
    const res = await fetch(`${host}/api/tags`);
    const data = await res.json() as { models: { name: string }[] };
    const names: string[] = data.models.map(m => m.name);
    const needed = [config.modelFilter, config.modelWriter];
    const missing = needed.filter(n => !names.some(found => found.startsWith(n)));
    return { ok: missing.length === 0, found: names, missing };
  } catch {
    return { ok: false, found: [], missing: [config.modelFilter, config.modelWriter] };
  }
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
