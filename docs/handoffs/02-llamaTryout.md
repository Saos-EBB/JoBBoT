# Handoff 2/2 — Branch `llamaTryout`: llama.cpp (`llama-server`) statt Ollama

> **NICHT MERGEN, BEVOR ES FUNKTIONIERT.** Dieser Branch ist ein Tryout. Er wird erst
> nach dem Vergleich mit der Ollama-Baseline vom User entschieden.

## Kontext

Repo: `/home/silence/instantJobbot`. Lies `CLAUDE.md` und `docs/handoffs/01-llmProvider.md`.
Voraussetzung: Der Branch `llmProvider` ist fertig. **Zweige von `llmProvider` ab, nicht
von `main`.** Fehlt er oder ist er nicht grün: stoppen und dem User sagen.

Ziel des Users: weg von Ollama. Getestet wird, ob llama.cpp direkt (`llama-server`)
schneller und kontrollierbarer ist.

Hardware: AMD Ryzen 5000 APU (Cezanne, Radeon-Vega-iGPU, keine dedizierte GPU), 30 GB
RAM, 16 Threads, Fedora 44. Bisher reine CPU-Inferenz, mehrere Minuten pro Anschreiben.

## Was anders ist als bei Ollama (vorher selbst verifizieren, Doku: github.com/ggml-org/llama.cpp, tools/server/README.md)

- `llama-server` spricht eine OpenAI-kompatible API: `POST /v1/chat/completions`,
  Streaming als SSE (`data: {...}` / `data: [DONE]`), nicht NDJSON. Health: `GET /health`.
- Kontextgröße (`-c`), Threads (`-t`) und Modell (`-m` / `-hf`) sind Startparameter
  des Servers, nicht pro Request. Der Thread-Wechsel im Retry (`providerOptions.num_thread`)
  wird hier ignoriert. Das bewusst dokumentieren.
- Ein Server-Prozess = ein Modell. Filter und Writer nutzen aktuell dasselbe Modell, also
  reicht ein Server. Prüfe, ob die aktuelle llama.cpp-Version mehrere Modelle kann
  (Router-Modus). Sonst: ein Server pro Modell auf getrennten Ports oder ein gemeinsames
  Modell. Entscheidung im Bericht begründen.
- JSON für den Filter: `response_format: { type: "json_object" }`. Reasoning aus: je
  nach Modell `chat_template_kwargs: { enable_thinking: false }` bzw. `--reasoning-budget 0`.
  `--jinja` für korrekte Chat-Templates.
- Prompt-Cache: `cache_prompt` (bei aktuellen Versionen Default an) spart Zeit, wenn der
  Prompt-Anfang gleich bleibt. Nur messen und berichten, den Prompt NICHT umbauen. Der
  Prompt muss in allen Branches identisch bleiben, sonst ist der Vergleich unfair.

## Aufgabe

1. llama.cpp installieren. Erst prüfen, ob `dnf` ein aktuelles `llama-cpp`-Paket hat.
   Sonst aus dem Quellcode bauen. **Zwei Varianten testen:** CPU und Vulkan
   (`-DGGML_VULKAN=ON`, nutzt die Vega-iGPU). Ob Vulkan auf dieser iGPU schneller ist,
   ist eine der Kernfragen dieses Branches. Was du am System installierst (dnf-Pakete,
   Build-Verzeichnis außerhalb des Repos), vorher dem User sagen.
2. Modelle als GGUF besorgen, gleiche Quantisierung wie Ollama (Q4_K_M):
   - `mistral-small3.2` 24B (Baseline, gleiches Modell wie bisher)
   - `gemma4:26b` (MoE, ~4B aktiv). Das ist der Favorit aus der Vorrecherche, weil MoE
     auf der CPU viel schneller sein sollte.
   - Die genauen Hugging-Face-Repos selbst nachschlagen, nichts raten. Vorher die
     Größe nennen (je 15–20 GB). RAM: nie zwei große Modelle gleichzeitig laden
     (OOM-Gefahr bei 30 GB).
3. `lib/llm/llamacpp.ts`: Provider nach dem Interface aus `llmProvider`.
   - `chat()` gegen `/v1/chat/completions` mit SSE-Parser. Den Parser so bauen, dass
     er für jede OpenAI-kompatible API taugt (`lib/llm/openai-compat.ts`).
   - `ensureReady()`: `/health` prüfen. Optional den Server selbst starten, analog zu
     `ensureOllama` (z. B. systemd-User-Unit). Wenn nicht: klare Fehlermeldung mit dem
     Startbefehl.
   - `check()`: prüfen, ob das geladene Modell zum konfigurierten passt (`/v1/models`).
   - In der Registry als `llamacpp` eintragen. Host/Port per env (`LLAMACPP_HOST`).
4. Startskript `scripts/llama-server.sh` (oder npm-Script) mit den getesteten
   Parametern (Modellpfad, `-c 4096`, `-t`, `--jinja`, Vulkan ja/nein).
5. Tests: SSE-Parser (inkl. Chunks, die mitten in einer Zeile reißen), Request-Mapping
   (json, think, temperature), Fehlerfall nicht-2xx. Mock-Server analog zu
   `mockChat` in `test/helpers.ts`.
6. Bench (aus `llmProvider`) laufen lassen, alles mit denselben 3 Jobs:
   - llama.cpp CPU + mistral-small3.2
   - llama.cpp Vulkan + mistral-small3.2
   - llama.cpp (schnellere Variante) + gemma4 26B
   - Pro Lauf: Zeit pro Brief, Tokens/s (Prompt und Generierung, aus den
     `timings` der Server-Antwort), Versuche, Prüfungsfehler, RAM-Spitze.

## Regeln

- Branch `llamaTryout` von `llmProvider`. Kein Merge nach `main`, kein Push ohne OK.
- Niemals `git add -A`/`git add .`, denn unter `data/` liegen fremde Änderungen.
  Modelle/GGUF und Build-Ordner nie ins Repo.
- Prompt (`SYSTEM`, `buildAnschreibenPrompt`) und Prüfung (`parseAnschreibenResponse`)
  nicht anfassen, sonst ist der Vergleich wertlos.
- Ollama nicht deinstallieren. Für die Messung Ollama stoppen
  (`systemctl --user stop ollama`), damit es keinen RAM belegt.
- Kommentare auf Deutsch, Commits klein (`feat(llm): llama.cpp-Provider …`).

## Fertig, wenn

- typecheck + Tests grün.
- `JOBBOT_LLM_PROVIDER=llamacpp npm run ui`: Ein Anschreiben über die UI erzeugt, der
  Filter im LLM-Modus urteilt korrekt (JSON parsebar).
- Bench-Ergebnisse liegen vor.
- Bericht an den User: Tabelle der Bench-Ergebnisse vs. Ollama-Baseline, CPU vs.
  Vulkan, Empfehlung, offene Probleme. Erst dann über einen Merge reden.
