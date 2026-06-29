# karriere.at Recon — Findings

Datum: 2026-06-29  
Testsuche: keyword="Junior Developer", Ort="Linz"

---

## robots.txt-Urteil: ERLAUBT

```
User-agent: *
Disallow:
```

Leere Disallow-Zeile = alles erlaubt. Nur bestimmte Bots (BLEXBot, AhrefsBot) werden explizit geblockt. Für einen generischen UA: grünes Licht.

---

## Gewählte Datenquellen

**Suchergebnisse:** `window.VUE_INITIAL_STATE` (Vue.js SSR, eingebettet im HTML)

Pfad: `jobsSearchList.activeItems.items[].jobsItem`

Karriere.at ist **kein Next.js** (kein `__NEXT_DATA__`), sondern Vue mit serverseitig gerenderten Initial-State-Daten. Die komplette Jobliste steckt als JSON im HTML — kein zweiter Request nötig.

**Detailseite:** JSON-LD `<script type="application/ld+json">` mit `@type: JobPosting`

Enthält die vollständige Beschreibung (HTML) und ISO-8601-Datum. Zusätzlich liefert `VUE_INITIAL_STATE.jobDetailContent.jobContent.html` dieselbe Beschreibung.

---

## Verfügbare Felder

### Suchergebnisseite (jobsItem)

| Feld | Wert (Beispiel) | Anmerkung |
|------|-----------------|-----------|
| `id` | `"7829963"` | numerische Job-ID |
| `title` | `"Junior Softwareentwickler..."` | vollständiger Titel |
| `company.name` | `"KERN engineering careers GmbH"` | |
| `locations[].name` | `"Linz"` | mehrere möglich |
| `link` | `"https://www.karriere.at/jobs/7829963"` | Detail-URL |
| `salary` | `"3.400 € – 4.400 € monatlich"` | optional, nicht immer vorhanden |
| `employmentTypes` | `"Vollzeit"` | |
| `date` | `"19.6.2026"` | **deutsches Format, kein ISO** |
| `snippet` | ~150 Zeichen | kurze Vorschau, kein vollständiger Text |

**Fehlt auf Suchergebnisseite:** vollständige Beschreibung, ISO-Datum.

### Detailseite (JSON-LD JobPosting)

| Feld | Wert (Beispiel) | Anmerkung |
|------|-----------------|-----------|
| `title` | `"Junior Softwareentwickler..."` | |
| `description` | vollständiger HTML-Text | sauber strukturiert (h2, ul, p) |
| `datePosted` | `"2026-06-19T12:44:54+02:00"` | ISO 8601 ✓ |
| `directApply` | `true/false` | |
| `employmentType` | | |
| `jobLocation` | | |

---

## Kernfrage: Plain Fetch oder Headless?

**Plain fetch reicht vollständig.**

Die Seite liefert alle relevanten Daten als SSR-HTML. Kein JavaScript muss ausgeführt werden. Getestet mit Standard-`fetch()` und Browser-UA.

Kein Anzeichen auf:
- JavaScript-gerenderte Inhalte (alles im initialen HTML)
- Anti-Bot-Maßnahmen (keine CAPTCHA, keine Cloudflare-Challenges)
- Login-Wall für Suchergebnisse

---

## Pagination

URL-Muster: `https://www.karriere.at/jobs/{keywordSlug}/{locationSlug}?seite={n}`

Beispiel: `.../jobs/junior-developer/linz?seite=2`

Nicht live getestet (nur Seite 1 gefetcht), aber Muster aus `api-sample.json` extrahiert.

---

## Empfehlung für 1.2b

**Strategie: 2-Request-Pipeline pro Job**

1. Search-Seite fetchen → `VUE_INITIAL_STATE.jobsSearchList.activeItems.items` parsen → Job-URLs + Basis-Metadaten
2. Pro Job: Detail-Seite fetchen → JSON-LD `JobPosting` parsen → `description` + `datePosted` (ISO)

**Field-Mapping:**

```
ScrapedJob.title        ← search: jobsItem.title
ScrapedJob.company      ← search: jobsItem.company.name
ScrapedJob.location     ← search: jobsItem.locations[0].name
ScrapedJob.url          ← search: jobsItem.link
ScrapedJob.salary       ← search: jobsItem.salary  (nullable)
ScrapedJob.description  ← detail: JSON-LD description (HTML-Text)
ScrapedJob.postedAt     ← detail: JSON-LD datePosted (ISO 8601)
```

Rate-Limit: 2s zwischen Requests (bereits in `fetchPage` + `sleep` implementiert).

**Kein Headless nötig.**
