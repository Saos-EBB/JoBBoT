# FINDINGS: devjobs.at Recon

Datum: 2026-06-29  
Testsuche: Junior Developer, Österreich  
Quellen: Wayback Machine (Snapshots Nov 2025), Live-HTTP-Tests

---

## 1. robots.txt — Urteil: UNBEKANNT (blockiert)

`robots.txt` ist **nicht abrufbar** — alle Requests an `www.devjobs.at` liefern
HTTP **429** + `x-vercel-mitigated: challenge`.

Der Challenge-Token im Response-Header (`x-vercel-challenge-token: 2.17...`) ist
Vercels WAF-Bot-Schutz (Proof-of-Work, JS-Execution required). Kein curl/fetch-Header
und kein Cookie-Trick umgeht das.

**Fazit**: robots.txt-Inhalt unbekannt. Kein explizites Scraping-Verbot beobachtet,
aber aktiver technischer Schutz ist vorhanden.

---

## 2. Bot-Schutz

| Test | Ergebnis |
|---|---|
| `curl robots.txt` | 429 + Vercel WAF-Challenge |
| Browser-Headers | 429 |
| Cookie-Jar | 429 |
| `/api/jobs`, `/sitemap.xml`, `/_next/data/...` | alle 429 |
| `api.devjobs.at` | 404 (kein API-Subdomain) |
| `?_data=routes/jobs/$canonical` (Remix endpoint) | 429 |

**Alle Pfade geblockt.** Plain `fetch()` funktioniert nicht.

---

## 3. Gewählte Datenquelle: `window.__remixContext` (SSR-Payload)

Framework: **Remix v2** (React Router, Vite-Build, Vercel-Hosting)

Erkennungszeichen:
- `data-discover="true"` auf Links (React Router v7)
- `window.__remixContext = { ... }` im HTML mit allen Loader-Daten
- Route-Namen: `routes/jobs/$canonical`, `routes/job/$jobSlug`

Daten sind **vollständig im HTML** eingebettet — kein separater API-Call nötig,
wenn man den HTML abrufen kann.

### Remix `?_data=` Endpoint (Alternative)

In Remix Classic Mode liefert `GET /jobs/search?_data=routes%2Fjobs%2F%24canonical`
direkt JSON (ohne HTML-Parsing). Wäre einfacher — aber auch 429-geblockt.

---

## 4. Verfügbare Felder

### Suchergebnis (`routes/jobs/$canonical → activeJobs[].model`)

| Feld | Pfad | Bemerkung |
|---|---|---|
| `title` | `metaJobTitle.title` | z.B. "Flutter Developer" |
| `company` | `company.title` | |
| `location` | `metaOsmLocations[0].title` | z.B. "Wien" |
| `url` | `/job/${slug}` | slug = 32-char hex |
| `postedAt` | `sortedAt` oder `createdAt` | ISO 8601 |
| `jobLevel` | `metaJobLevel.title` | "Junior" / "Senior" etc. |
| `salary` | `salaryYearRangeFrom` / `salaryYearRangeTo` | Jahresbruttogehalt |
| `workingModel` | `metaJobWorkingModels[].slug` | "remote", "hybrid", "onsite" |
| `description` | ❌ nicht in Suchergebnis | nur excerpt vorhanden |

### Detailseite (`routes/job/$jobSlug → job`)

| Feld | Pfad | Bemerkung |
|---|---|---|
| `description` | `jobDescriptionHtml.html` | vollständiges HTML |
| `responsibilities` | `responsibilities.content` | Rich Text (Slate-Format) |
| `qualifications` | `qualifications.content` | Rich Text |
| `salary` | `salaryRangeFrom/To` + `salaryYearRangeFrom/To` | Monat + Jahr |
| `directApply` | `directApply` | mailto: oder URL |

**Alle relevanten Felder vorhanden.** Für description braucht's den Detailabruf.

### Such-URL für Junior + Ort

```
/jobs/search?jobLevel=junior-job-level
/jobs/search?jobLevel=junior-job-level&workingModels=remote
/jobs/search?jobLevel=junior-job-level&osmState=wien-109166    # Wien
/jobs/search?jobLevel=junior-job-level&osmState=linz-..        # Linz (slug nötig)
```

`osmState`-Slugs aus `facetDistribution.osmState` in der ersten Response ablesen.

---

## 5. Plain fetch reicht? NEIN

Vercel WAF blockiert zuverlässig alle HTTP-Only-Clients (curl, Node fetch, Axios, etc.).
Die Challenge erfordert echte JavaScript-Ausführung im Browser.

---

## 6. Empfehlung für 2.1b

**Option A — Playwright** (empfohlen):

```ts
// npm install -D playwright
// npx playwright install chromium
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://www.devjobs.at/jobs/search?jobLevel=junior-job-level');
// Playwright löst die JS-Challenge automatisch
const remixContext = await page.evaluate(() => window.__remixContext);
// → remixContext.state.loaderData["routes/jobs/$canonical"].activeJobs
```

- Playwright ist eine **devDependency** (nur für Scraping-Scripts nötig)
- Chromium-Binary wird einmalig via `npx playwright install chromium` geladen (~130 MB)
- Challenge wird automatisch gelöst
- Danach: `?_data=` Endpoint direkt via Cookie aus Browser abrufbar

**Option B — devjobs.at überspringen**:
Anderes österreichisches Job-Portal ohne Bot-Schutz nehmen
(z.B. jobs.at, stepstone.at — prüfen ob plain fetch dort klappt).

**Option C — Cookie-Injection** (nicht empfohlen):
Challenge einmalig manuell im Browser lösen, Cookie extrahieren,
in Bot injizieren. Cookie-TTL unbekannt, nicht wartbar.

---

## Fixtures

| Datei | Quelle | Inhalt |
|---|---|---|
| `search.html` | Wayback 2025-11-15 | `/jobs/search` Vollseite |
| `detail.html` | Wayback 2025-10-18 | `/job/53dc1b...` Flutter Dev |
| `search-remix-context.json` | extrahiert aus search.html | 79 KB, enthält activeJobs[15] |
| `detail-remix-context.json` | extrahiert aus detail.html | 35 KB, vollständige Job-Details |
