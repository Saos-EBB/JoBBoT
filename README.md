# JobBot

Lokaler Job-Scraper mit LLM-Anschreiben-Generator. Scraper holen Jobs von Karriere.at, DevJobs.at u.a.; Qwen 3b filtert, Qwen 7b schreibt Anschreiben.

## Setup

```bash
npm install
ollama pull qwen2.5:3b
ollama pull qwen2.5:7b
```

## Commands

```bash
npm run check   # Ollama + Modelle prüfen
npm run smoke   # Storage end-to-end testen
npm run dev     # Health-Summary
npm run typecheck
```

## Storage

Ein JSON-File pro Job unter `data/jobs/<id>.json`. Kein globales Sammel-JSON. Dedup via Datei-Existenz.
Das gesamte System redet nur über das `Storage`-Interface mit dem Speicher — austauschbar gegen SQLite ohne Codeänderungen außerhalb von `storage/`.
