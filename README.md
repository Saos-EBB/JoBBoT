# JoBBoT

<img src="docs/images/tschobbo.jpeg" alt="TschoBBo, das JoBBoT-Maskottchen" width="480">

*[English](README.en.md)*

Lokaler Job-Scraper mit LLM-Anschreiben-Generator. Läuft komplett offline/lokal
(Ollama), keine Cloud-Abhängigkeit. Pipeline: **Scrape → Filter → Anschreiben
→ Review** (Review/Versand sind aktuell manuell).

Das ist **TschoBBo**, das Maskottchen von JoBBoT. Die vielen Arme sind Absicht:
er ist es, der im Hintergrund gleichzeitig Inserate greift, sie filtert, das
Anschreiben tippt und die Bewerbung in den Ordner einsortiert — die Pipeline
soll sich weniger nach totem Skript-Output anfühlen und mehr danach, dass da
jemand für dich arbeitet.

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

## Modellwahl

Mehrere lokale Ollama-Modelle wurden für die Anschreiben-Generierung
durchgetestet (volle Rohdaten: `data/anschreiben/test/`), damit andere sich
den Vergleich sparen können:

| Modell | Ergebnis |
|---|---|
| `qwen2.5:7b` | Qualität nicht befriedigend — aussortiert |
| `qwen3.5:9b` | Am schnellsten (~115s/Job), aber halluzinierte in mehreren Testjobs Skills, die nicht im Profil stehen |
| `qwen3:30b` | Zu groß fürs CPU-only-Setup — jeder Testjob lief in Timeout (>10min) |
| `gemma3:12b` | Ordentliche Qualität, aber als einziges Modell mehrfach Retries nötig; RAM-Verbrauch stieg über eine Testreihe kontinuierlich ohne Plateau (~15→23GB) — reales OOM-Risiko bei längeren Batches |
| `mistral-small3.2:latest` | Beste Qualität (am ehrlichsten bei fehlenden Skills, keine erfundenen Parallelen), stabilster RAM-Verbrauch, keine Retries — **aktuelle Wahl** für Filter und Anschreiben |

Die Temperatur- und Dauer-Werte im Abschnitt „Performance" unten beziehen
sich auf `mistral-small3.2`, das produktiv eingesetzte Modell.

## Performance

Getestet auf einem Lenovo T14 (AMD Ryzen 7 PRO 5850U), 6 CPU-Kernen, kein
GPU-Support unter Ollama. CPU-Temperatur
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

npm run ui   # Job-Browser + Gmail-Anbindung, http://localhost:3000
```

Flags stehen hinter `--` (npm-Konvention, sonst parst npm sie selbst) und
lassen sich kombinieren, z. B. `npm run anschreiben -- --data=save --limit=3`.

`npm run scrape` schreibt neue Jobs nach `data/jobs/`. `npm run filter` setzt
den Status jedes Jobs (siehe Lifecycle unten) und schreibt einen Report nach
`data/filter-log.md`. `npm run anschreiben` legt fertige Briefe unter
`data/anschreiben/titel_firma_datum_id8.md` ab, versucht dabei zusätzlich
eine Bewerbungs-E-Mail-Adresse zu finden (Regex im Inserat, sonst Fallback
über firmenabc.at) und protokolliert jeden Lauf (Modell, `--data`-Filter,
Anzahl, gefundene E-Mails) in `data/anschreiben/AnschreibenLog.md`.

`scripts/anschreiben-model-bench.ts` ist kein Pipeline-Schritt, sondern ein
Dev-Tool zum Vergleichen mehrerer Ollama-Modelle auf denselben Test-Jobs.

### Gmail-Anbindung

`npm run ui` zeigt pro Job (sobald Status `reviewed` ist) eine editierbare
E-Mail-Vorschau (An/Betreff/Text) mit zwei Aktionen: **Entwurf erstellen**
(landet als echter, editierbarer Entwurf in Gmail) oder **Direkt senden**
(mit Bestätigungsdialog). Beide laufen über ein Gmail App-Passwort, nicht
über OAuth:

1. 2-Step-Verification im Google-Konto aktivieren (falls noch nicht an).
2. App-Passwort erzeugen: `myaccount.google.com/apppasswords` (im normalen
   Security-Menü nicht mehr verlinkt — Google hat den Link versteckt, direkt
   aufrufen oder über die Suche im Google-Konto finden).
3. `.env` anlegen (siehe `.env.example`, gitignored):
   ```
   GMAIL_USER=deine-adresse@gmail.com
   GMAIL_APP_PASSWORD=das-16-stellige-app-passwort
   ```
4. `npm run ui` — lädt `.env` automatisch (`--env-file-if-exists`, braucht
   Node ≥21.7).

Fehlt `.env`, läuft die UI trotzdem — nur Entwurf/Senden schlagen mit einer
klaren Fehlermeldung fehl statt die Seite zu blockieren.

## UI & Server

`npm run ui` startet `scripts/ui-server.ts` — ein reiner `node:http`-Server
(kein Framework), der zwei Dinge gleichzeitig macht:

- **Statisches Frontend**: `ui/app.tsx` (React) wird per `npm run build:ui`
  (esbuild) zu `ui/dist/app.js` gebaut und unter `/app.js` ausgeliefert. Nach
  jeder Änderung an `ui/app.tsx` muss neu gebaut werden — kein Hot-Reload.
- **JSON-API**, die das SPA per `fetch` anspricht: `/api/jobs`,
  `/api/jobs/:id` (Status/Fit ändern), `/api/jobs/:id/brief` (Anschreiben
  bearbeiten), `/api/jobs/:id/draft` bzw. `/api/jobs/:id/send` (Gmail),
  `/api/attachment` (Lebenslauf-Upload) sowie `/api/scrape/*` und
  `/api/filter/*` (siehe unten).

### Scrape/Filter aus der UI

Die Sidebar hat eine eigene „Pipeline"-Gruppe mit zwei Einträgen — **Scrape**
und **Filter** —, die `npm run scrape`/`npm run filter` aus dem Browser statt
vom Terminal aus anstoßen. Beide laufen nach demselben Muster:

1. `POST /api/scrape` (Quellenauswahl) bzw. `POST /api/filter`
   (`regex`-/`llm`-Modus) startet den Lauf **im Hintergrund** im
   Server-Prozess und antwortet sofort mit einer `runId` — kein Warten auf
   eine lange HTTP-Response.
2. Das SPA pollt `GET /api/scrape/status` bzw. `/api/filter/status` alle
   ~1,5s, unabhängig davon, welche Ansicht gerade offen ist — deshalb bleibt
   der Fortschrittsbalken unter dem Sidebar-Eintrag sichtbar, auch wenn man
   zwischendurch in die Job-Liste wechselt.
3. Läuft bereits ein Lauf desselben Typs, antwortet ein zweiter `POST` mit
   `409` statt einen zweiten Lauf zu starten.
4. Nach Abschluss zeigt die UI einen Toast mit der Kurzbilanz (z. B. „14
   neu, 6 dedup") und lädt die Job-Liste automatisch neu.

Der Server hält den Lauf-Status nur im Prozessspeicher (kein
Neustart-Recovery) — für ein lokales Einzelnutzer-Tool ausreichend.

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
`anschreiben` setzt `generated`. `reviewed` wird manuell in der UI gesetzt
(Status-Dropdown) — erst danach schaltet die UI Entwurf/Versand frei.
`drafted`/`sent` setzt die UI selbst, und zwar nur bei tatsächlich
erfolgreichem Gmail-Aufruf (kein Statuswechsel bei Fehlern). Es gibt weiterhin
keinen Auto-Send ohne diesen expliziten Klick.

## Umgebungsvariablen

| Variable | Default |
|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` |
| `JOBBOT_MODEL_FILTER` | `mistral-small3.2:latest` |
| `JOBBOT_MODEL_WRITER` | `mistral-small3.2:latest` |
| `GMAIL_USER` | — (siehe [Gmail-Anbindung](#gmail-anbindung)) |
| `GMAIL_APP_PASSWORD` | — (siehe [Gmail-Anbindung](#gmail-anbindung)) |
| `UI_PORT` | `3000` |
