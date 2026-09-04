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
| `sources.json` | Welche Portale aktiv sind (karriere.at, devjobs.at, LinkedIn, AMS, jobs.at) + Suchqueries pro Portal — **auch über die UI editierbar**, siehe [Einstellungsseite „Suche"](#einstellungsseite-suche) |
| `location.json` | Whitelist an Städten/Regionen (Oberösterreich) + Remote-Keywords — **auch über die UI editierbar** |
| `experience-rules.json` | Keyword-/Phrasenlisten für den Regex-Filter (Erfahrungsjahre, Junior-Signale, Ausschluss-/Negationswörter) |
| `settings.json` | `filterMode` (`regex` oder `llm`) und Fallback-`filterModel` |

### Config anpassen

`sources.json` und `location.json` lassen sich seit v0.5 über die
Einstellungsseite **Suche** im Browser ändern — ohne Editor, ohne
JSON-Kenntnisse, auch auf dem Handy. Die drei übrigen Dateien werden weiterhin
von Hand bearbeitet.

Alle Config-Dateien werden bei jeder Nutzung frisch gelesen (`loadSources()`,
`loadLocationConfig()` in `lib/scrape-setup.ts`) — ein Server-Neustart ist nach
einer Änderung nicht nötig.

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
npm run filter:all                # ALLE Jobs neu triagen, nicht nur 'new' (--scope=all)
npm run filter -- --scope=all     # äquivalent, direkt per Flag (new | all, Default new)

npm run duplicates   # Report: Jobs, die nach Normalisierung (Kleinschreibung, Gender-
                      # marker, Rechtsform) auf dieselbe ID zusammenfallen. Löscht nichts.

npm run anschreiben                       # Anschreiben für alle triaged Jobs (fit != brutal) generieren
npm run anschreiben -- --data=save        # nur data/jobs/matched/   (fit "matched")
npm run anschreiben -- --data=unsave      # nur data/jobs/offstack/  (fit "offstack")
npm run anschreiben -- --limit=5          # nur die ersten N Jobs der Auswahl
npm run anschreiben -- --source=<modell>  # Ollama-Modell für diesen Lauf überschreiben

npm run ui                  # Job-Browser + Gmail-Anbindung, http://localhost:3000
npm run ui -- --port=3001   # anderen Port erzwingen (sonst UI_PORT-Env oder 3000)
```

Flags stehen hinter `--` (npm-Konvention, sonst parst npm sie selbst) und
lassen sich kombinieren, z. B. `npm run anschreiben -- --data=save --limit=3`.

`npm run scrape` schreibt neue Jobs nach `data/jobs/`. `npm run filter` setzt
Status `triaged` + `fit` (siehe Lifecycle unten) und schreibt einen Report nach
`data/filter-log.md`; mit `--scope=all` werden dabei alle vorhandenen Jobs neu
triagiert statt nur die mit Status `new` — nützlich nach einer Änderung an den
Filterregeln, damit die Datenbank nicht auf alten Urteilen sitzen bleibt.
Ein Re-Triage fällt nur das **Urteil** (`fit`) neu; den Status setzt es
ausschließlich für Jobs, die noch in der Triage stecken (`new`/`triaged`) —
ein Job mit fertigem Anschreiben oder eine versendete Bewerbung bleibt, wo
sie ist.
`npm run duplicates` findet Jobs, deren Titel+Firma nach Normalisierung
(Kleinschreibung, Gendermarker wie `(m/w/d)`, Rechtsformen wie `GmbH`) auf
dieselbe ID zusammenfallen — reiner Report, keine automatische Löschung.
`npm run anschreiben` legt fertige Briefe unter
`data/anschreiben/titel_firma_id8.md` ab, versucht dabei zusätzlich
eine Bewerbungs-E-Mail-Adresse zu finden (Regex im Inserat, sonst Fallback
über firmenabc.at) und protokolliert jeden Lauf (Modell, `--data`-Filter,
Anzahl, gefundene E-Mails) in `data/anschreiben/AnschreibenLog.md`.

Der Dateiname trägt bewusst **kein Datum** — und gesucht wird ohnehin nur über
das `id8`-Präfix, siehe [Storage](#storage).

`scripts/anschreiben-model-bench.ts` ist kein Pipeline-Schritt, sondern ein
Dev-Tool zum Vergleichen mehrerer Ollama-Modelle auf denselben Test-Jobs.

### Gmail-Anbindung

`npm run ui` zeigt pro Job (sobald Status `freigegeben` ist) eine editierbare
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
  `/api/attachment` (Lebenslauf-Upload), `/api/duplicates` (Duplikat-Report,
  GET, synchron), `/api/duplicates/merge` (Duplikat-Gruppe zusammenführen),
  `/api/calendar` (Kalender-Ereignisse, GET, synchron), `/api/mail/replies/fetch`
  (Gmail-Inbox nach Antworten durchsuchen), `/api/gmail-sync` (rückwirkend
  `sentAt`/`replyReceivedAt` nachtragen, read-only gegenüber Gmail),
  `/api/jobs/:id/followup` (Nachfass als Entwurf oder Versand),
  `/api/config/schema` (Suchfelder je Portal), `/api/config/sources` und
  `/api/config/location` (GET/PUT) samt `/api/config/:name/restore` sowie
  `/api/scrape/*` und `/api/filter/*` (siehe unten).

Die Oberfläche hat drei Breitenbänder:

- **unter 1024px** wird die Seitenleiste zu einer Schublade (Burger in einer
  Kopfzeile, Overlay, Esc). Der Startordner ist dort der erste nicht-leere,
  sonst der Scraper — sonst landet man auf einem leeren Ordner ohne Weg heraus.

Der zuletzt gewählte Ordner wird in `localStorage` gemerkt und überlebt einen
Reload. Vorher startete jedes F5 hart auf „Mit Mail → Entwürfe"; wer in „Ohne
Mail → Entwürfe" stand, landete danach im gleichnamigen, aber leeren
Nachbarordner — es sah aus, als wären die Entwürfe verschwunden.
- **1024–2000px**: drei Spalten, stetig über `clamp()` statt in Stufen.
- **ab 2000px** stehen Anschreiben und Inserat nebeneinander statt in Tabs.

### Scrape/Filter aus der UI

Die Sidebar hat eine eigene „Pipeline"-Gruppe mit den Einträgen **Scrape**,
**Filter**, **Duplikate**, **Anschreiben** und **Nachfassen**, die die jeweiligen
`npm run <x>`-Skripte aus dem Browser statt vom Terminal aus anstoßen.
Scrape/Filter/Anschreiben laufen nach demselben Muster:

1. `POST /api/scrape` (Quellenauswahl) bzw. `POST /api/filter`
   (`regex`-/`llm`-Modus + `new`-/`all`-Scope, siehe oben) startet den Lauf
   **im Hintergrund** im Server-Prozess und antwortet sofort mit einer
   `runId` — kein Warten auf eine lange HTTP-Response.
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

**Duplikate** läuft nach einem anderen, einfacheren Muster: `GET
/api/duplicates` ist eine synchrone Leseoperation ohne Hintergrundlauf/Polling
— sie liefert die Duplikat-Gruppen direkt in der Response. Die UI ruft sie
beim Öffnen der Ansicht auf; ein „Neu prüfen"-Button stößt einen erneuten
Abruf an. Pro Gruppe (oder für alle auf einmal) lässt sich per
„Zusammenführen"-Button konsolidieren: Das neueste Inserat bleibt, übernimmt
aber das `scrapedAt` des ältesten Duplikats; die restlichen Dateien werden
gelöscht.

### Mehrfachauswahl in der Job-Liste

Jede Zeile hat eine Checkbox, in jedem Ordner. Sobald etwas ausgewählt ist,
erscheint eine Leiste mit **Verschieben** (Jobs / Aussortiert / Gelöscht),
**Urteil** (Match / Offstack / Brutal), **Löschen** und **Anschreiben (n)**.

Zwei Feinheiten, die nicht offensichtlich sind:

- Die Zahl am Anschreiben-Knopf ist kleiner als die Auswahl, wenn darunter
  ungefilterte oder als brutal bewertete Jobs sind — der Lauf kann die nicht
  verarbeiten. Auswählbar bleiben sie trotzdem, weil sie fürs Löschen und
  Verschieben sehr wohl gemeint sind.
- „Verschieben → Jobs" nimmt ein brutales Urteil auf `offstack` mit. *Jobs* und
  *Aussortiert* sind beide `status: triaged` und unterscheiden sich **nur** im
  `fit` (siehe `lib/folders.ts`); ohne die Urteilsänderung fiele der Job sofort
  zurück, was aussähe wie „nichts passiert".

Gesendete Bewerbungen sind nicht auswählbar — sie sind überall sonst in der UI
schreibgeschützt, und eine Mehrfachaktion soll das nicht hintenrum aushebeln.

### Einstellungsseite „Suche"

Der Eintrag **Suche** (bei Anhang und CC) macht `sources.json` und
`location.json` im Browser editierbar. Zwei Abschnitte, weil es zwei
verschiedene Dinge sind, die beide „Ort" heißen könnten:

- **Suchgebiet** — geht an das Portal. Nur LinkedIn und AMS haben eins; die
  übrigen drei suchen österreichweit und werden erst hinterher gefiltert.
- **Umkreis** — `location.json`, wirkt **nach** dem Scrapen über `isInRange()`
  und gilt für alle fünf Quellen.

Die Form eines Portalblocks folgt der Feldzahl, nicht dem Portalnamen: ein Feld
wird zur Chip-Wolke, mehrere werden zu beschrifteten Zeilen. Woher die Seite das
weiß: jeder `ScraperAdapter` trägt seit v0.5 ein **`querySchema`** —
Pflichtfeld, ein Portal ohne Schema compiliert nicht. `GET /api/config/schema`
liefert es an den Browser.

Dasselbe Schema prüft an drei Stellen: im Formular beim Tippen, im Server vor
dem Schreiben und in den Adaptern beim Lesen. Alle drei rufen `checkQuery()`
aus `lib/query-schema.ts` auf — die Regeln gibt es genau einmal. Eine Anfrage
mit einem Tippfehler im Schlüssel (`keywords` statt `keyword`) wurde früher
kommentarlos übersprungen; jetzt meldet der Adapter sie, und die Seite bietet
„Reparieren" an, wenn die Absicht eindeutig ist.

Das aufklappbare Roh-JSON ist eine **Ansicht**, kein zweiter Editor —
schreibgeschützt mit Kopieren-Knopf, damit es keine zweite Wahrheit gibt.

Beim Speichern wandert die bisherige Fassung nach `<datei>.bak`, und
„Letzte Fassung zurückholen" holt sie zurück. Eine Stufe tief; alles Ältere
holt git, denn beide Dateien sind versioniert.

**Eine Warnung ist eingebaut**: „Österreich" als Region. `COUNTRY_ONLY`
(`lib/location-terms.ts`) wird in `isInRange()` **exakt** verglichen, eine
Region dagegen per Substring — „Österreich" dort einzutragen behielte also jeden
Job mit „…, Österreich" und hängt den Umkreisfilter praktisch aus. Die
naheliegendste Eingabe überhaupt, und die einzige, die still das ganze Verhalten
umdreht. Gewarnt, nicht verboten.

### Nachfassen

Der Eintrag **Nachfassen** listet Bewerbungen, die seit mindestens
`FOLLOW_UP_DAYS` (3, siehe `lib/followup.ts`) ohne Antwort sind — am längsten
Wartende oben, mit Fällig-Zähler an der Sidebar. Auswahl einzeln oder alle, dann
als Sammelaktion **Als Entwurf** (Gmail-Entwurf) oder **Senden**.

Die Uhr läuft ab dem **letzten Kontakt**, nicht ab `sentAt`: nach einem Nachfass
ist derselbe Job drei Tage später wieder fällig, und das wiederholt sich bis eine
Antwort kommt. Ein angelegter Entwurf zählt dabei als erledigt — sonst bekäme
derselbe Job beim nächsten Blick einen zweiten. Die Historie steht als
`followUps: [{ at, via }]` am Job, daher auch „2× nachgefasst" in der Zeile.

Der Betreff bleibt absichtlich der der Bewerbung (`Bewerbung als X bei Y`): so
landet der Nachfass im selben Gmail-Thread, und `lib/mail-match.ts`
rekonstruiert genau diesen Betreff, um eingehende Antworten einem Job zuzuordnen.
Ein eigener Nachfass-Betreff ließe eine Antwort darauf am Betreff-Abgleich
vorbeilaufen. Der Text ist neu und kurz, nicht das Anschreiben ein zweites Mal.

### Kalender

Der Sidebar-Tab „Kalender" zeigt, wann Bewerbungen rausgingen (`sentAt`), wann
nachgefasst wurde (`followUps`) und wann Antworten zurückkamen
(`replyReceivedAt`) — Tag = Quadrat, Woche = Zeile, Monat = Block, neuester
Monat zuerst. Drei Farben, Legende im Kopf; ein Tag mit mehreren Sorten wird
entsprechend geteilt. Jeder Nachfass ist ein eigener Eintrag, nicht nur der
letzte — der Kalender soll zeigen, wie oft nachgehakt wurde. Klick auf einen Tag öffnet ein Popup mit
den Einträgen des Tages und springt von dort zur Job-Detailansicht.

Die Monatsreihe läuft lückenlos von `HISTORY_START` (`lib/calendar.ts`, aktuell
`2026-07-01`) bis heute — also über denselben Zeitraum, den der Gmail-Sync
scannt. Monate ohne Aktivität bekommen trotzdem einen Block, damit weit
auseinanderliegende Monate keine Nachbarschaft vortäuschen; sie starten
eingeklappt. Jeder Monatskopf ist ein Umschalter, die Summe daneben
(„2 gesendet · 1 Antwort") verrät auch im eingeklappten Zustand, ob sich das
Aufklappen lohnt.
Antworten werden nicht automatisch erkannt: ein „Antworten abrufen"-Button im
„Gesendet"-Ordner (Verlauf) durchsucht die Gmail-Inbox per
`POST /api/mail/replies/fetch` (E-Mail+Betreff-Abgleich, keine Message-ID) und
setzt `replyReceivedAt` auf Treffer — Jobs mit Antwort tragen danach ein
Badge „Antwort erhalten", mit Filter „Nur mit Antwort" im Verlauf.

### Gmail-Sync (rückwirkend)

Der Button „Gmail-Sync" oben rechts im Kalender-Tab trägt Daten nach, die im
Job-JSON fehlen (`POST /api/gmail-sync`): der
Gesendet-Ordner liefert `sentAt`, die Inbox `replyReceivedAt`. Gedacht für
Bewerbungen, die vor der Einführung dieser Felder rausgingen oder händisch
am Bot vorbei — laufende Versände schreiben ihr `sentAt` ohnehin selbst.

Gescannt wird ab `HISTORY_START` (`lib/calendar.ts`, aktuell `2026-07-01`) —
derselbe Startpunkt, ab dem der Kalender anzeigt.

**Welche Mails zählen:** nur die, die in Gmail mit dem Label `Bewerbung` oder
`Beworben` markiert sind (`BEWERBUNGS_LABELS` in `mail/gmail.ts`). Das Label ist
die verlässlichste Quelle: `job.email` geht bei einem Re-Scrape verloren und der
Betreff ändert sich, wenn ein Inserat neu eingelesen wird — deine Markierung
bleibt. Ohne Label passiert nichts, und private Mails landen nie im Kalender.

**Zuordnung zum Job** läuft über zwei gleichwertige Schlüssel: den
rekonstruierten Betreff (`Bewerbung als … bei …`, aus Titel+Firma jederzeit
neu berechenbar) und die Empfängeradresse. Trifft einer, bekommt der Job sein
`sentAt`.

**Mails ohne Job** — weil das Inserat gelöscht, neu eingelesen oder händisch
geschrieben wurde — verschwinden nicht, sondern landen in
`data/mail-events.json` und erscheinen im Kalender als eigener Eintrag mit dem
Vermerk „nur Mail" (nicht anklickbar, es gibt keine Detailansicht dazu). Titel
und Firma kommen aus dem Betreff; passt der nicht aufs Muster, dient die
Empfänger-Domain als Beschriftung. Die Datei ist ein Abbild des Postfachs, kein
Verlauf: jeder Lauf schreibt sie komplett neu, und sie ist gitignored, weil sie
Empfängeradressen enthält.

Die Meldung nach dem Lauf nennt jede Stufe einzeln — gelesen, markiert,
verknüpft, nur Mail —, weil ein blankes „0 ergänzt" offenließe, ob das Postfach
leer war, das Label fehlt oder die Zuordnung nichts fand.

Drei Eigenschaften, auf die man sich verlassen kann:

- **read-only gegenüber Gmail.** Beide Ordner werden mit `readOnly: true`
  geöffnet; der Sync sendet, löscht und verschiebt nichts und markiert auch
  nichts als gelesen. Der Gesendet-Ordner wird über das IMAP-Flag
  `\Sent` gefunden, nicht über den (lokalisierten) Ordnernamen.
- **Füllt nur Lücken.** Ein vorhandenes `sentAt`/`replyReceivedAt` wird nie
  überschrieben, damit ein heuristischer Treffer keinen echten Wert zerstört.
  Mehrfache Läufe sind dadurch gefahrlos.
- **Ändert keinen Status.** Geschrieben werden ausschließlich die zwei
  Datumsfelder.

Die Zuordnung ist Heuristik, keine exakte Zuordnung: die Message-ID wurde beim
ursprünglichen Senden nie gespeichert. Gematcht wird über die exakte
Empfängeradresse, der rekonstruierte Betreff (`Bewerbung als … bei …`) dient
nur als Tiebreaker, wenn mehrere Jobs dieselbe Firmenadresse teilen. Bleibt es
mehrdeutig, wird nichts gesetzt — ungematchte Jobs bleiben schlicht undatiert.

## Tests

```bash
npm test           # node:test + node:assert/strict, kein extra Package
npm run test:watch # watch mode
```

Alle Tests laufen gegen Temp-Verzeichnisse und einen lokalen Mock-Server —
kein echtes Ollama, kein echtes `data/jobs/`.

## Storage

Ein JSON-File pro Job unter `data/jobs/titel_firma_datum_id8.json` (getriagte
Jobs landen zusätzlich in `data/jobs/matched/`, `data/jobs/offstack/` oder
`data/jobs/brutal/`, je nach fit).
Kein globales Sammel-JSON, Dedup via Datei-Existenz. Die Job-`id` ist ein
deterministischer 16-stelliger SHA-256-Hash aus Titel + Firma (die ersten 8
Zeichen davon stecken im Dateinamen) — derselbe Job wird beim erneuten
Scrapen nie doppelt angelegt.

### Wie eine Datei ihren Job findet

Sowohl Job-JSONs als auch Anschreiben werden **über das `id8`-Präfix am Ende
des Dateinamens** gesucht, nie über den ganzen Namen. Der lesbare Teil davor
ist Dekoration:

```
data/jobs/titel_firma_datum_id8.json      JsonStore.findFile()
data/anschreiben/titel_firma_id8.md       findAnschreiben()  (lib/anschreiben-datei.ts)
```

Der Grund ist Erfahrung, nicht Geschmack. Das Anschreiben wurde früher über
den vollen Namen inklusive **Datum** gesucht — und das Datum ist kein Teil der
Identität, sondern ein Wert, der sich ändert:

- ein **Re-Scrape** derselben Stelle liefert ein neues `postedAt`
- ein **Duplikat-Merge** setzt `keep.scrapedAt` auf das des ältesten Zwillings

In beiden Fällen war der bereits geschriebene Brief für seinen eigenen Job
unsichtbar — beim Merge sogar für den Job, den der Merge behält. Am
2026-09-04 betraf das 46 von 101 Dateien. Deshalb steht die Auflösung jetzt an
genau einer Stelle (`lib/anschreiben-datei.ts`) statt an vieren, ein
Schreibvorgang räumt eine Datei unter altem Namen weg, und ein Merge nimmt das
Anschreiben eines entfernten Zwillings mit.

### Einmal-Skripte

Reparaturen am Bestand, kein Teil der Pipeline. Alle laufen ohne Argument als
**Dry-Run** und legen mit `--apply` vorher ein Backup unter `data/backup-*/`
an (gitignored):

```bash
npx tsx scripts/repair-status.ts          # Status aus Anschreiben-Datei + mail-log herstellen
npx tsx scripts/repair-anschreiben.ts     # Briefe ihren Jobs zuordnen, Waisen entfernen
npx tsx scripts/migrate-descriptions.ts   # Beschreibungen nachträglich normalisieren
```

Das gesamte System redet nur über das `Storage`-Interface (`storage/index.ts`)
mit dem Speicher — austauschbar gegen SQLite ohne Codeänderungen außerhalb
von `storage/`.

## Job-Lifecycle

```
new → triaged → generated → freigegeben → postausgang → gesendet
                                              (+ geloescht/fehler als Sonderpfade)

new/triaged ⇄ offline   (Offline-Archiv, siehe unten — beide Richtungen automatisch)
```

`scrape` erzeugt `new`. `filter` setzt Status `triaged` — das eigentliche
Urteil steckt in einem eigenen `fit`-Feld (`matched`/`offstack`/`brutal`,
weiterhin manuell in der UI überschreibbar), nicht mehr im Status selbst.
`anschreiben` setzt `generated`. `freigegeben` wird manuell in der UI gesetzt
— erst danach schaltet die UI Entwurf/Versand frei. `postausgang` (Gmail-
Entwurf erstellt, Versand noch nicht bestätigt) und `gesendet` setzt die UI
selbst, nur bei tatsächlich erfolgreichem Gmail-Aufruf (kein Statuswechsel bei
Fehlern, die landen stattdessen auf `fehler`). `geloescht` ist von den meisten
Stellen aus erreichbar (Papierkorb, kein Datei-Löschen). Es gibt weiterhin
keinen Auto-Send ohne den expliziten „Gesendet bestätigen"-Klick.

**Die Pipeline läuft nur vorwärts.** Ein Re-Triage (`--scope=all`) fällt das
`fit`-Urteil neu, setzt den Status aber nur für Jobs, die noch in der Triage
stecken. Vorher tat er das bedingungslos — jeder solche Lauf warf
`generated`/`postausgang`/`gesendet` auf Anfang zurück, und die betroffenen
Bewerbungen standen wieder im „Jobs"-Ordner, als wäre nie eine geschrieben
oder versendet worden. Am 2026-09-04 betraf das 21 versendete Bewerbungen und
33 Jobs mit fertigem Anschreiben; `scripts/repair-status.ts` hat sie aus
Anschreiben-Dateien und `data/mail-log.md` wiederhergestellt.

`gesendet` ist nicht das Ende: `followUps` sammelt jeden Nachfass als
`{ at, via }` (siehe [Nachfassen](#nachfassen)). Der Status ändert sich dabei
**nicht** — die Bewerbung war gesendet und bleibt es, ein Nachfass ist kein
neuer Zustand, sondern ein weiterer Kontakt. Ebenso `replyReceivedAt`: eine
Antwort ist eine Zusatzinformation, kein Statuswechsel.

## Offline-Archiv

Beim Scrapen prüft der Lauf, ob gespeicherte Inserate noch online stehen. Ist
eins nachweislich weg, wandert der Job in den Status `offline` und erscheint im
UI unter **Verlauf → Offline**. Taucht dasselbe Inserat später wieder in den
Suchergebnissen auf, holt derselbe Lauf ihn automatisch zurück.

**Zwei Stufen.** „Im Lauf nicht gefunden" wählt nur die *Kandidaten* aus (das
kostet nichts, die Ergebnisse liegen ohnehin vor); archiviert wird erst, wenn
ein Einzelabruf der Job-URL das *bestätigt*.

Die billige Stufe allein reicht nicht: die Suchanfragen sind über die
[Einstellungsseite](#einstellungsseite-suche) frei editierbar — nach einer
Änderung von „Linz" auf „Wels" wäre der halbe Bestand nicht gefunden. Dazu
kommen Pagination-Deckel: ein vor Wochen gescraptes Inserat steht längst nicht
mehr auf Seite 1 und ist trotzdem online. Ein still archivierter lebender Job
ist ein verpasster Job; ein Lauf zu spät archivierter kostet nichts.

**Was archiviert wird — und was nicht:**

| Schutz | Regel |
| --- | --- |
| Status | nur `new` und `triaged`. Ab `generated` steckt eigene Arbeit im Job (Anschreiben, Freigabe, Versand) — dass das Portal das Inserat gezogen hat, beendet die laufende Bewerbung nicht. |
| Quelle | nur Quellen, die in **diesem** Lauf liefen **und** durchkamen. Ein Netzwerkausfall oder eine abgewählte Quelle archiviert nichts. |
| Signal | nur ein **geprüftes** Offline-Signal. `unbekannt` (Rate-Limit, Timeout, Serverfehler) lässt den Job in Ruhe. |
| Menge | höchstens 25 Nachprüfungen pro Lauf, 1 s Pause, ältestes Inserat zuerst. Der Rest kommt beim nächsten Lauf dran. |

**Geprüfte Offline-Marker** (`lib/offline-check.ts`, nachgemessen am
2026-09-04). Was hier fehlt, bekommt kein geratenes Muster:

| Quelle | Marker |
| --- | --- |
| karriere.at | HTTP 404 **oder** 200 mit Weiterleitung weg von `/jobs/<nr>` — ein abgelaufenes Inserat antwortet dort mit 200 auf einer Suchseite, der Statuscode allein trennt tot und lebendig also nicht. |
| jobs.at, linkedin, devjobs.at, ams | nur 404/410. Für diese Quellen lag kein Offline-Sample vor (devjobs.at antwortete auf den ersten Testabruf mit 429), also gibt es dort keinen zusätzlichen Marker. |

**Zurückholen** braucht kein gespeichertes „vorher"-Feld: archiviert werden nur
`new` und `triaged`, und die beiden unterscheidet genau das `fit`-Feld — ohne
`fit` zurück auf `new`, mit `fit` zurück auf `triaged`. Nur der Status wird
angefasst, `email`/`fit`/`scrapedAt` überleben unverändert.

**Bekannte Einschränkung:** liegen für eine ID zwei Dateien (Altbestand aus
einer Zeit vor der jetzigen `hash.ts`), trifft der Statuswechsel nur eine davon.
Das ist das bestehende Duplikat-Thema — `npm run duplicates` zeigt es an.

## Umgebungsvariablen

| Variable | Default |
|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` |
| `JOBBOT_MODEL_FILTER` | `mistral-small3.2:latest` |
| `JOBBOT_MODEL_WRITER` | `mistral-small3.2:latest` |
| `GMAIL_USER` | — (siehe [Gmail-Anbindung](#gmail-anbindung)) |
| `GMAIL_APP_PASSWORD` | — (siehe [Gmail-Anbindung](#gmail-anbindung)) |
| `UI_PORT` | `3000` (überschreibbar per `npm run ui -- --port=<n>`, das gewinnt vor `UI_PORT`) |
