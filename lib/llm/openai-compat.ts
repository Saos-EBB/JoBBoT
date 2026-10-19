import type { ChatRequest } from './types.ts';

// Client für OpenAI-kompatible Chat-APIs (POST {base}/v1/chat/completions). Spricht
// llama.cpp (llama-server), taugt aber für jede API dieser Form (DeepSeek, vLLM, …) —
// backend-eigene Zusatzfelder kommen über `extraBody` vom jeweiligen Provider.

interface Delta {
  choices?: { delta?: { content?: string | null } }[];
  error?: { message?: string } | string;
}

// SSE-Stream (`data: {...}`-Zeilen, Ende mit `data: [DONE]`) zu Text zusammensetzen.
// Nur delta.content zählt — reasoning_content (versteckter Denkanteil) bleibt draußen.
// Ein Fehler-Event mitten im Stream wirft.
export async function readSseContent(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return; // Kommentare (": ping"), event:, leere Zeilen
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') return;
    const chunk = JSON.parse(payload) as Delta;
    if (chunk.error) {
      const msg = typeof chunk.error === 'string' ? chunk.error : chunk.error.message;
      throw new Error(`Stream-Fehler: ${msg ?? 'unbekannt'}`);
    }
    content += chunk.choices?.[0]?.delta?.content ?? '';
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
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);

  return content;
}

// Neutrales Request → OpenAI-Body. Kontextgröße und Threads sind bei diesen Servern
// Start-Einstellungen (llama.cpp: Preset), nicht Teil des Requests.
export function buildOpenAiBody(req: ChatRequest, extraBody: Record<string, unknown> = {}): Record<string, unknown> {
  const { model, messages, stream = false, json, temperature, maxTokens } = req;
  const body: Record<string, unknown> = { model, messages, stream, ...extraBody };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  if (json) body.response_format = { type: 'json_object' };
  return body;
}

// Wirft bei Netzwerkfehler und nicht-2xx (mit Fehlertext des Servers, falls vorhanden).
export async function openAiChat(host: string, req: ChatRequest, extraBody?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(`${host}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(buildOpenAiBody(req, extraBody)),
    signal: req.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`/v1/chat/completions ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  if (req.stream) return readSseContent(res);
  const data = await res.json() as { choices?: { message?: { content?: string | null } }[] };
  return data?.choices?.[0]?.message?.content ?? '';
}
