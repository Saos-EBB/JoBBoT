# JoBBoT

*[English](README.en.md)*

Lokaler Job-Scraper mit LLM-Anschreiben-Generator. Läuft komplett offline/lokal
(Ollama), keine Cloud-Abhängigkeit. Pipeline: **Scrape → Filter → Anschreiben
→ Review** (Review/Versand sind aktuell manuell).

## Setup

```bash
npm install
npx playwright install chromium   # nur für AMS/DevJobs.at (Browser-Scraper)
ollama pull mistral-small3.2:latest   # Filter- und Anschreiben-Modell
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
| `settings.json` | `filterMode` (`regex` oder `llm`) und Fallback-`filterModel` |

### Config anpassen

- **`sources.json`**: Portale ein-/ausschalten und Suchqueries pro Portal
  ändern, wenn zu wenig/zu viele Treffer reinkommen.
- **`location.json`**: Städte/Regionen zur Whitelist hinzufügen, Remote-
  Keywords ergänzen, wenn passende Jobs rausgefiltert werden.
- **`experience-rules.json`**: Keyword-Listen (Erfahrungsjahre, Junior-
  Signale, Ausschlusswörter) nachschärfen, wenn `data/filter-log.md` zeigt,
  dass der Regex-Filter falsch klassifiziert (zu streng → raus, zu lasch →
  unsicher).
- **`settings.json`**: `filterMode` auf `llm` stellen, um statt Regex den
  Ollama-Filter zu nutzen (braucht laufendes Ollama + `filterModel`).

## Performance

Getestet auf 6 CPU-Kernen, kein GPU-Support unter Ollama. CPU-Temperatur
unter Last: Peak ~81°C, im Schnitt ~70°C. Ein Anschreiben dauert ~3-4 Min,
abhängig davon wie gut Job und Profil zusammenpassen (vgl. die Testfälle
`clean`/`offstack`/`brutal` in `scripts/anschreiben-model-bench.ts` — clean
= guter fachlicher Fit, offstack = Tech-Stack weicht ab, brutal = großer
fachlicher Mismatch, mehr Text zu Lücken/Ehrlichkeit nötig).

## Commands

```bash
npm run check   # Ollama erreichbar + Modelle installiert?
npm run smoke    # Storage end-to-end testen (JsonStore-Lifecycle)
npm run dev      # Health-Summary + aktuelle Job-Anzahl in storage
npm run typecheck
```

### Pipeline

```bash
npm run scrape                       # alle aktivierten Quellen aus sources.json
npm run scrape:karriere              # einzelne Quelle: karriere | devjobs | linkedin | ams | jobs
npm run scrape -- --source=karriere  # äquivalent, direkt per Flag

npm run filter                    # alle 'new' Jobs filtern (Modus aus settings.json)
npm run filter:regex              # Regex-Strategie erzwingen (offline, kein Ollama nötig)
npm run filter -- --source=llm    # Modus direkt per Flag erzwingen (llm | regex)

npm run anschreiben                       # Anschreiben für alle matched/uncertain Jobs generieren
npm run anschreiben -- --data=save        # nur data/jobs/sicher/    (Status "matched")
npm run anschreiben -- --data=unsave      # nur data/jobs/unsicher/  (Status "uncertain")
npm run anschreiben -- --limit=5          # nur die ersten N Jobs der Auswahl
npm run anschreiben -- --source=<modell>  # Ollama-Modell für diesen Lauf überschreiben
```

Flags stehen hinter `--` (npm-Konvention, sonst parst npm sie selbst) und
lassen sich kombinieren, z. B. `npm run anschreiben -- --data=save --limit=3`.

`npm run scrape` schreibt neue Jobs nach `data/jobs/`. `npm run filter` setzt
den Status jedes Jobs (siehe Lifecycle unten) und schreibt einen Report nach
`data/filter-log.md`. `npm run anschreiben` legt fertige Briefe unter
`data/anschreiben/titel_firma_datum_id8.md` ab und protokolliert jeden Lauf
(Modell, `--data`-Filter, Anzahl) in `data/anschreiben/AnschreibenLog.md`.

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
| `JOBBOT_MODEL_FILTER` | `mistral-small3.2:latest` |
| `JOBBOT_MODEL_WRITER` | `mistral-small3.2:latest` |
