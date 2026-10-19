// Die neutrale LLM-Schnittstelle. Alles, was ein Aufrufer (Filter, Anschreiben, Bench)
// über das Backend wissen muss, steht hier — und nichts Backend-Spezifisches. Jedes
// Backend (lib/llm/llamacpp.ts, …) übersetzt diese Form in sein eigenes Wire-Format.

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  // Streaming ist ein Transportdetail (frühe Header gegen undicis headersTimeout bei
  // langsamen Modellen); chat() liefert in beiden Fällen den fertigen Text.
  stream?: boolean;
  // Antwort als JSON-Objekt erzwingen (Filter-Urteil).
  json?: boolean;
  // false unterdrückt versteckten Reasoning-Anteil bei Modellen, die das können.
  think?: boolean;
  temperature?: number;
  // Obergrenze für die Antwortlänge (Klassifizierer: ein Buchstabe).
  maxTokens?: number;
  signal?: AbortSignal;
  // Basis-URL des Backends; ungesetzt → Default des Providers.
  host?: string;
}

export interface ModelPair {
  filter: string;
  writer: string;
}

export interface CheckResult {
  ok: boolean;
  found: string[];
  missing: string[];
}

export interface LlmProvider {
  name: string;
  // Die Modelle, die ein Lauf mit diesem Backend tatsächlich benutzt.
  resolveModels(configDir?: string): ModelPair;
  // Wirft bei Netzwerkfehler und nicht-2xx — Retry/Regenerierung bleibt beim Aufrufer.
  chat(req: ChatRequest): Promise<string>;
  // Vor einem Lauf: Backend erreichbar machen (ggf. starten) oder mit klarer Meldung werfen.
  ensureReady(host?: string): Promise<void>;
  // Health-Check ohne Wurf: sind die gebrauchten Modelle da?
  check(host?: string, models?: ModelPair): Promise<CheckResult>;
  // Hinweis, wie ein fehlendes Modell zu holen ist (für Konsolenausgaben).
  missingHint(model: string): string;
  // Modell aus dem RAM werfen (Bench: nie zwei große Modelle zugleich). Optional —
  // Backends mit festem Modell pro Serverprozess haben nichts zu entladen.
  unload?(model: string, host?: string): Promise<void>;
}
