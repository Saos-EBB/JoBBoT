# FINDINGS — jobs.at

Recon only, kein Adapter gebaut. UA: `Mozilla/5.0 (compatible; JobBot/0.1; +local)`.

## Step A1 — robots.txt

`https://www.jobs.at/robots.txt` → HTTP 200.

```
User-agent: BLEXBot
Disallow: /

User-agent: *
Disallow:

Sitemap: https://www.jobs.at/sitemaps/sitemap-jobs.xml
(+ 5 weitere Sitemaps)
```

**Verdict: ALLOWED.** `User-agent: *` hat leeren `Disallow:` (= alles erlaubt). Nur `BLEXBot` ist komplett gesperrt, betrifft uns nicht. Kein `Crawl-delay`.

## Step A2 — Suchseite + Bot-Schutz-Check

- URL: `https://www.jobs.at/jobs?q=software-entwickler` → `302` → `https://www.jobs.at/j` → `200 OK`.
- Kein Bot-Schutz: keine `cf-ray`/`cf-mitigated`/`x-vercel-*`-Header, kein "Just a moment"/Captcha im Body. Server: nginx, Backend `x-backend: web01`, Cookies zeigen Laravel-App (`XSRF-TOKEN`, `laravel_session`).
- Datenquelle: **kein** JSON-LD-Joblist, **kein** `__NEXT_DATA__`/`__NUXT__`/`__INITIAL_STATE__` auf der Suchseite. Stattdessen Tier (d)/(c)-Hybrid: serverseitig gerendertes HTML mit reichen `data-*`-Attributen pro Job-Karte:

⚠️ **Korrektur (siehe STEP 2 unten):** `?q=...` ist **kein funktionierender Such-Parameter** — er wird beim 302-Redirect verworfen. Die tatsächlich funktionierende Such-URL ist pfadbasiert: `https://www.jobs.at/j/{keyword-slug}`.

```html
<h2 class="c-job-title ..." data-job-title>
  <a class="j-c-link" href="https://www.jobs.at/i/7811246" data-c-id="7811246"
     data-c-company="15165" data-c-title="Lead Buyer für schweren Stahlbau (m/w/d)">
    Lead Buyer für schweren Stahlbau (m/w/d)
  </a>
</h2>
...
<a data-job-company data-gtm-element-detail="Liebherr-Werk Nenzing GmbH"
   href="https://www.jobs.at/a/liebherr-werk-nenzing">Liebherr-Werk Nenzing GmbH</a>
...
<li><a href="https://www.jobs.at/j/-/linz">Linz</a></li>
```

~15 Jobs pro Seitenaufruf, Detail-URL-Muster `https://www.jobs.at/i/{jobId}`. Fixture: `test/fixtures/jobs-at/search.html` (495.788 Bytes).

## STEP 2 — Such-Mechanik verifiziert (vor dem Adapter-Bau)

### (a) Keyword-Filterung

`https://www.jobs.at/jobs?q=<kw>` → 302 → `https://www.jobs.at/j` — der Query-String wird beim Redirect **verworfen**. Getestet mit `q=java` vs. `q=frontend`, mit und ohne wiederverwendetem Cookie-Jar (Laravel-Session): alle drei Requests lieferten **exakt dieselben 15 Jobs** in derselben Reihenfolge. Keyword-Filterung über `?q=` funktioniert nicht, Session/Cookies spielen keine Rolle.

**Gefundene funktionierende Alternative:** `https://www.jobs.at/j/{keyword-slug}` (pfadbasiert, analog zu den Location-Links `/j/-/{ort}`). Verifiziert über 8 verschiedene Slugs:

| Slug | Status | Ergebnis |
|---|---|---|
| `software-entwickler` | 200 | Software-Entwickler-Jobs |
| `java` | 200 | Java-spezifische Jobs, klar anders als oben |
| `junior-software-entwickler`, `junior-entwickler`, `webentwickler` | 200 | Mehrwort/Bindestrich-Slugs funktionieren |
| `büro` (roh) / `buero` (transliteriert) | 200 | beide funktionieren, leicht unterschiedliche (nicht identische) Trefferlisten — Transliteration empfohlen für stabile URL-Erzeugung im Code |
| `Java` vs `java` | 200 / 200 | **case-insensitive**, byte-identische Ergebnismengen |
| `marketing` | 200 | klar andere, branchenpassende Treffer — bestätigt, dass Filterung kein Zufall ist |

Kombination Keyword+Ort im selben Pfad (`/j/{kw}/-/{ort}`) → **404**, nicht unterstützt.

### (b) Ort in der Suchkarte

**JA.** Jede Job-Karte (`<li data-job="{id}" data-c-id="{id}" ...>`) enthält einen `<ul data-job-location>`-Block mit `<a class="js-locationLink" href="https://www.jobs.at/j/-/{ort-slug}">{Ort}</a>` — Location-Gate kann also **vor** dem Detail-Fetch greifen (wie bei devjobs.at), analog zu `location: r.company?.address?.municipality` bei AMS.

### (c) Pagination — wichtige Einschränkung

**Keine statische Pagination.** Nur die ersten ~15 Jobs pro Keyword sind per plain fetch erreichbar:
- `?page=2` → HTTP 301, wird vom Server auf die kanonische URL zurückgeleitet (aktiv entfernt).
- `?p=2`, `?offset=15` → HTTP 200, aber **byte-identische** Ergebnismenge wie Seite 1 (Parameter werden ignoriert).
- `/j/entwickler/2` → HTTP 404.
- HTML enthält `<div id="job-infinite-search-results" ...>` + `<noscript>`-Hinweis "Bitte aktiviere JavaScript ... um weitere Ergebnisse zu laden" — Pagination läuft rein über Client-JS (Infinite Scroll), der zugrunde liegende AJAX-Call ist nicht im inline-HTML sichtbar (vermutlich im externen JS-Bundle, nicht untersucht).

**Konsequenz:** Ein plain-fetch-Adapter bekommt pro Keyword nur die ersten ~15 Treffer. Entschieden: akzeptieren, mit mehreren Keywords in `config/sources.json` ausgleichen (gleiches Muster wie bei karriere.at/devjobs.at) — kein Playwright für volle Pagination.

## Step A3 — Detailseite

- URL: `https://www.jobs.at/i/7811246` → `200 OK`, kein Bot-Schutz, gleicher nginx/Laravel-Fingerprint.
- Datenquelle: **Tier (a) — sauberes JSON-LD `JobPosting`**, ein einzelner `<script type="application/ld+json">`-Block (bestätigt gegen die Fixture):

```json
{
  "@context": "https://schema.org", "@type": "JobPosting",
  "title": "Lead Buyer für schweren Stahlbau (m/w/d)",
  "employmentType": ["FULL_TIME"],
  "datePosted": "2025-08-25",
  "description": "<p>One Passion. Many Opportunities. ...</p> ...",
  "hiringOrganization": { "@type": "Organization", "name": "Liebherr-Werk Nenzing GmbH", "logo": "..." },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Nenzing", "addressRegion": "Vorarlberg", "addressCountry": "Österreich" } },
  "identifier": { "@type": "PropertyValue", "name": "jobs.at", "value": 7811246 },
  "directApply": true
}
```

Alle Zielfelder direkt aus diesem einen JSON-Blob extrahierbar:

| Feld | Quelle | Status |
|---|---|---|
| title | `title` | ✓ |
| company | `hiringOrganization.name` | ✓ |
| location | `jobLocation.address.addressLocality`/`addressRegion` | ✓ |
| url | `https://www.jobs.at/i/{identifier.value}` | ✓ |
| postedAt | `datePosted` (ISO) | ✓ |
| description | `description` (HTML, ~4000 Zeichen) | ✓ |

Fixture: `test/fixtures/jobs-at/detail.html` (182.326 Bytes).

## Gesamturteil

**Plain fetch reicht vollständig — mit einer Einschränkung.** Kein Cloudflare/Vercel-Bot-Challenge, robots.txt erlaubt explizit. Empfohlener Ansatz für einen künftigen Adapter (analog `karriere-at.ts`, kein Playwright nötig):

1. Suchseite pro Keyword über `https://www.jobs.at/j/{keyword-slug}` (NICHT `?q=`, siehe STEP 2a), Job-IDs/Detail-URLs + Ort aus `data-c-id`/`href="https://www.jobs.at/i/{id}"`/`data-job-location` extrahieren (Tier d/c-Hybrid, HTML-Regex reicht wie bei karriere.at). Location-Gate kann hier schon greifen (STEP 2b).
2. Jede Detailseite per plain fetch, JSON-LD `JobPosting`-Block parsen (Tier a) — liefert alle Felder sauber strukturiert, keine weitere HTML-Extraktion für die Detaildaten nötig.
3. **Limit:** ~15 Treffer pro Keyword, keine statische Pagination (STEP 2c). Ausgleich über mehrere Keywords in `config/sources.json`, kein Playwright.

## Fixtures

- `test/fixtures/jobs-at/search.html` (495.788 Bytes)
- `test/fixtures/jobs-at/detail.html` (182.326 Bytes)

Insgesamt 3 Requests (robots.txt + Suche + Detail), UA wie vereinbart, ~2s Abstand, 10s Timeout.

## Vergleich jobs.at vs. willhaben (siehe FINDINGS-willhaben.md)

| Quelle | robots.txt | Bot-Schutz | Datenquelle | plain fetch? | Aufwand |
|---|---|---|---|---|---|
| jobs.at | erlaubt (`Disallow:` leer für `*`) | keiner | Suche: HTML-Karten mit `data-*`-Attributen · Detail: JSON-LD `JobPosting` | Ja | gering — 1:1 wie `karriere-at.ts` |
| willhaben | Suche disallowed (`/jobs/suche?*`, `/*?*keyword=*`, `/jobs/webapi/`) + pauschales Bot-Verbot am Dateianfang | nicht getestet (gestoppt vor Suche) | nicht geprüft | nicht relevant | — nicht scrapbar |

**Empfehlung:** jobs.at als nächsten Adapter bauen — reines `plain fetch` + Regex/JSON-Parsing, kein Playwright, gleiche Bauweise wie `scrapers/karriere-at.ts` (Suchseite für IDs, Detailseite für JSON-LD). willhaben komplett auslassen, robots.txt verbietet genau den Suchpfad, den der Bot bräuchte — kein Umgehen versucht.
