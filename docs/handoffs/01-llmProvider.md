# Handoff 1/2 — Branch `llmProvider`: neutrale LLM-Provider-Schnittstelle

> Dieser Branch ist die Basis für `llamaTryout`. Er muss fertig und grün
> sein, BEVOR der Tryout startet. Kein Merge nach `main`, solange nicht alles
> funktioniert (siehe "Fertig, wenn").

## Kontext

Repo: `/home/silence/instantJobbot` (Job-Bewerbungs-Bot, TypeScript, Node, kein Framework).
Lies zuerst `CLAUDE.md`. Tests: `node:test` + `node:assert/strict`, `npm test`, `npm run typecheck`.

Ziel des Users: weg von Ollama, verschiedene LLM-Backends vergleichen (llama.cpp lokal).
Dafür braucht es zuerst EINE Stelle, an der das Backend getauscht
wird. Dieser Branch baut nur diese Schnittstelle, mit Ollama als einziger Implementierung.
**Das Verhalten bleibt 1:1 gleich.**

Hardware des Users (wichtig für alle drei Branches): AMD Ryzen 5000 APU (Cezanne,
Vega-iGPU, keine dedizierte GPU), 30 GB RAM, 16 Threads, Fedora 44. Inferenz läuft auf
der CPU, ein Anschreiben dauert mehrere Minuten.

## Ist-Zustand (am 2026-10-09 geprüft)

- `lib/ollama.ts` ist der einzige Chat-Client: `chat(req: ChatRequest)`, dazu
  `checkOllama`, `ensureOllama`, `resolveModels`, `readNdjsonContent`.
- Aufrufer von `chat()`: `lib/anschreiben.ts`, `lib/filter-llm.ts`,
  `scripts/one-off/anschreiben-model-bench.ts`.
- Aufrufer von `ensureOllama`/`checkOllama`: `lib/filter-runner.ts:67`,
  `scripts/routes/anschreiben.ts:59`, `scripts/run-anschreiben.ts:45`, `run.ts:8`,
  `scripts/check-ollama.ts`.
- Ollama-Begriffe, die aus der Schnittstelle raus müssen:
  - `options: { num_thread, num_ctx, temperature }`. `num_thread` kommt aus
    `RETRY_CONFIG` in `lib/anschreiben.ts` (6/6/4 Threads pro Versuch).
  - `format: 'json'` (Filter), `think` (Reasoning aus), NDJSON-Streaming.
  - `config.ollamaHost`, Modellnamen `mistral-small3.2:latest` in `config.ts` und
    `config/settings.json` (`filterModel`).

## Aufgabe

1. Lege `lib/llm/` an:
   - `types.ts`: neutrales `ChatRequest` mit `model`, `messages`, `stream?`, `json?: boolean`
     (statt `format`), `think?`, `temperature?`, `numCtx?`, `signal?` und einem
     `providerOptions?: Record<string, unknown>` als Durchreiche für Backend-Spezifisches
     (z. B. `num_thread` bei Ollama). Interface `LlmProvider { name; chat(req);
     ensureReady(models); check(models) }`.
   - `ollama.ts`: der heutige Code aus `lib/ollama.ts`, hinter dem Interface. Er übersetzt
     das neutrale Request ins Ollama-Format.
   - `index.ts`: `getProvider()` wählt das Backend über die env-Variable
     `JOBBOT_LLM_PROVIDER` (Default `ollama`). Unbekannter Wert → klarer Fehler.
     Eine Registry, damit die Tryout-Branches nur eine Datei plus eine Zeile ergänzen.
2. Stelle alle Aufrufer auf `getProvider()` um. `lib/ollama.ts` bleibt höchstens als
   dünner Re-Export oder verschwindet, wenn kein Aufrufer mehr daran hängt.
3. `num_thread` im Retry von `lib/anschreiben.ts` wandert in `providerOptions`. Andere
   Backends dürfen es ignorieren. Kommentar dazu: Threads sind bei llama.cpp ein
   Server-Startparameter.
4. Config: `config.ts` bekommt `llmProvider`. Host und Modell pro Provider so ablegen,
   dass ein Tryout eigene Werte setzen kann, ohne die Ollama-Werte zu überschreiben.
5. Vergleichs-Bench vorbereiten, die Basis für den späteren Vergleich aller Branches:
   - `scripts/one-off/anschreiben-model-bench.ts` provider-neutral machen
     (`getProvider()`, Provider + Modell per env/CLI).
   - Die Jobpfade in `JOBS` prüfen. Sie zeigen auf Dateien, die durch fit-Wechsel
     umgezogen sein könnten. Lieber über die Job-ID per Glob suchen.
   - Pro Lauf messen: Gesamtzeit pro Brief, Anzahl Versuche, warum die Prüfung
     fehlschlug, Zeichen/Wörter. Ergebnis nach
     `data/anschreiben/test/bench/<provider>_<modell>/` plus eine Zeile pro Lauf in einer
     CSV oder Markdown-Tabelle.
   - Ein Ollama-Baseline-Lauf mit `mistral-small3.2` gehört ins Ergebnis dieses Branches,
     falls Ollama läuft. Falls nicht: im Bericht sagen, nicht vortäuschen.
6. Tests: Bestehende Tests müssen weiter grün sein (`test/ollama*.test.ts` ggf.
   umziehen). Neu dazu: ein Test für `getProvider()` (Default, unbekannter Wert) und
   einer, dass das Ollama-Provider-Request aus dem neutralen Request korrekt gebaut wird
   (`mockChat` aus `test/helpers.ts` nutzen).
7. `CLAUDE.md`, Abschnitt "LLM setup", auf die neue Struktur aktualisieren.

## Regeln

- Branch `llmProvider` von `main` abzweigen. Kein Push, kein Merge ohne OK des Users.
- **Achtung git:** Unter `data/` sind viele Dateien geändert, die nicht zu dir gehören.
  Niemals `git add -A` oder `git add .`, nur gezielt die eigenen Dateien stagen.
- Kleine Commits pro logischem Schritt, Commit-Stil wie im Log (`feat(llm): …`,
  `refactor(llm): …`). Kommentare im Code auf Deutsch, wie im Rest des Repos.
- Nichts über den Auftrag hinaus bauen (kein llama.cpp hier).

## Fertig, wenn

- `npm run typecheck` und `npm test` sind grün.
- Mit `JOBBOT_LLM_PROVIDER` ungesetzt verhält sich alles wie vorher: UI-Anschreiben-Lauf
  und Filter im LLM-Modus mit Ollama einmal echt ausprobiert. Falls Ollama nicht läuft:
  so berichten.
- Die Bench läuft mit `--provider ollama` und schreibt Ergebnisse.
- Kurzer Bericht an den User: Was geändert wurde, wie ein neuer Provider registriert
  wird (Dateien und Zeilen), was offen ist.
