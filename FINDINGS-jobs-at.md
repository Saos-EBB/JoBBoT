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

**Plain fetch reicht vollständig.** Kein Cloudflare/Vercel-Bot-Challenge, robots.txt erlaubt explizit. Empfohlener Ansatz für einen künftigen Adapter (analog `karriere-at.ts`, kein Playwright nötig):

1. Suchseite(n) per plain fetch, Job-IDs/Detail-URLs aus `data-c-id`/`href="https://www.jobs.at/i/{id}"` extrahieren (Tier d/c-Hybrid, HTML-Regex reicht wie bei karriere.at).
2. Jede Detailseite per plain fetch, JSON-LD `JobPosting`-Block parsen (Tier a) — liefert alle Felder sauber strukturiert, keine weitere HTML-Extraktion für die Detaildaten nötig.

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
