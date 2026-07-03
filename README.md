# JobBot

Lokaler Job-Scraper mit LLM-Anschreiben-Generator. Läuft komplett offline/lokal
(Ollama), keine Cloud-Abhängigkeit. Pipeline: **Scrape → Filter → Anschreiben
→ Review** (Review/Versand sind aktuell manuell).

## Setup

```bash
npm install
npx playwright install chromium   # nur für AMS/DevJobs.at (Browser-Scraper)
ollama pull qwen3.5:9b            # Filter-Modell
ollama pull gemma3:12b            # Anschreiben-Modell
cp config/profile.example.json config/profile.json   # eigene Daten eintragen
```

`config/profile.json` ist gitignored — dort stehen Name, Ausbildung, Skills,
Projekte und Links, die in jedes generierte Anschreiben einfließen.

## Konfiguration (`config/`)

| Datei | Zweck |
|---|---|
| `profile.json` | Bewerberprofil für die Anschreiben-Generierung (aus `profile.example.json` kopieren) |
| `sources.json` | Welche Portale aktiv sind (karriere.at, devjobs.at, LinkedIn, AMS, jobs.at) + Suchqueries pro Portal |
| `location.json` | Whitelist an Städten/Regionen (Oberösterreich) + Remote-Keywords |
| `experience-rules.json` | Keyword-/Phrasenlisten für den Regex-Filter (Erfahrungsjahre, Junior-Signale, Ausschluss-/Negationswörter) |
| `settings.json` | `filterMode` (`regex` oder `llama`) und Fallback-`filterModel` |

## Commands

```bash
npm run check   # Ollama erreichbar + Modelle installiert?
npm run smoke    # Storage end-to-end testen (JsonStore-Lifecycle)
npm run dev      # Health-Summary + aktuelle Job-Anzahl in storage
npm run typecheck
```

### Pipeline

```bash
npm run scrape             # alle aktivierten Quellen aus sources.json
npm run scrape:karriere    # einzelne Quelle: karriere | devjobs | linkedin | ams | jobs

npm run filter             # alle 'new' Jobs filtern (Modus aus settings.json)
npm run filter:regex       # Regex-Strategie erzwingen (offline, kein Ollama nötig)

npm run anschreiben        # Anschreiben für alle matched/uncertain Jobs generieren
```

`npm run scrape` schreibt neue Jobs nach `data/jobs/`. `npm run filter` setzt
den Status jedes Jobs (siehe Lifecycle unten) und schreibt einen Report nach
`data/filter-log.md`. `npm run anschreiben` legt fertige Briefe unter
`data/anschreiben/titel_firma_datum_id8.md` ab.

`scripts/anschreiben-model-bench.ts` ist kein Pipeline-Schritt, sondern ein
Dev-Tool zum Vergleichen mehrerer Ollama-Modelle auf denselben Test-Jobs.

## Tests

```bash
npm test           # node:test + node:assert/strict, kein extra Package
npm run test:watch # watch mode
```

Alle Tests laufen gegen Temp-Verzeichnisse und einen lokalen Mock-Server —
kein echtes Ollama, kein echtes `data/jobs/`.

## Storage

Ein JSON-File pro Job unter `data/jobs/titel_firma_datum_id8.json` (matched/
uncertain landen zusätzlich in `data/jobs/sicher/` bzw. `data/jobs/unsicher/`).
Kein globales Sammel-JSON, Dedup via Datei-Existenz. Die Job-`id` ist ein
deterministischer 16-stelliger SHA-256-Hash aus Titel + Firma (die ersten 8
Zeichen davon stecken im Dateinamen) — derselbe Job wird beim erneuten
Scrapen nie doppelt angelegt.

Das gesamte System redet nur über das `Storage`-Interface (`storage/index.ts`)
mit dem Speicher — austauschbar gegen SQLite ohne Codeänderungen außerhalb
von `storage/`.

## Job-Lifecycle

```
new → filtered_out | matched → generated → reviewed → drafted → sent
```

`scrape` erzeugt `new`, `filter` setzt `filtered_out`/`matched`/`uncertain`,
`anschreiben` setzt `generated`. Review, Drafting und Versand sind aktuell
manuelle Schritte — es gibt (noch) keinen Auto-Send.

## Umgebungsvariablen

| Variable | Default |
|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` |
| `JOBBOT_MODEL_FILTER` | `qwen3.5:9b` |
| `JOBBOT_MODEL_WRITER` | `gemma3:12b` |
