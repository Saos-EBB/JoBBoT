# FINDINGS — willhaben.at (Jobs)

Recon only, kein Adapter gebaut. UA: `Mozilla/5.0 (compatible; JobBot/0.1; +local)`.

## Step B1 — robots.txt

`https://www.willhaben.at/robots.txt` → HTTP 200, 3904 bytes. Fixture: `test/fixtures/willhaben/robots.txt`.

**Verdict: DISALLOWED für Job-Suche.**

Belege (verbatim aus der Datei):

```
# It is expressively forbidden to use spiders, search robots or other automatic methods
# to access willhaben.at. Only if willhaben.at has given such access is allowed.
```

Plus maschinenlesbare Regeln unter `User-agent: *`:

- `Disallow: /jobs/webapi/` — die Jobs-Backend-API ist explizit gesperrt.
- `Disallow: /jobs/suche?*` — die Job-Suchergebnisseite selbst ist gesperrt.
- `Disallow: /jobs/suche*?similarAdvert*` — auch verwandte Job-Suche gesperrt.
- `Disallow: /*?*keyword=*` — **globale** Regel: jede URL mit `keyword=`-Query-Param ist auf der ganzen Domain verboten. Das killt beide im Task vorgeschlagenen Such-URL-Muster (`/iad/jobs/searchresult?keyword=...`, `/jobs/suche?keyword=...`) unabhängig vom genauen Pfad.
- Kein `Crawl-delay` für `User-agent: *` (nur für `yahoo-slurp`/`msnbot` gesetzt, nicht relevant).
- `Sitemap: https://cache.willhaben.at/jobs/service/public/sitemaps/sitemap.xml` — eigener Jobs-Sitemap-Service auf Subdomain `cache.willhaben.at`. Sitemaps sind zum Crawlen gedacht, d.h. einzelne Job-**Detail**-URLs daraus wären technisch vermutlich nicht durch einen Disallow gedeckt — aber das löst nicht den eigentlichen Use-Case (Suche nach Junior/Software-Entwickler-Keywords), der explizit gesperrt ist.

## Step B2/B3 — nicht ausgeführt

Gemäß Safe-Steps ("STOPP, nicht umgehen-tricksen") nicht weiterverfolgt: Die für den Use-Case nötige Suchseite ist per robots.txt explizit disallowed, zusätzlich zur pauschalen "keine Bots ohne Erlaubnis"-Ansage am Dateianfang. Kein Such- oder Detail-Fetch versucht, keine Datenquelle (JSON-LD/`__NEXT_DATA__`/API) geprüft.

## Gesamturteil

**Nicht politely scrapbar.** Das ist kein "braucht Headless"-Fall, sondern ein robots.txt-Policy-Block auf Domain- und Pfad-Ebene. Kein Adapter, keine weiteren Requests.

## Fixtures

- `test/fixtures/willhaben/robots.txt` (einzige gesicherte Datei — robots.txt selbst ist öffentlich und zum Abrufen gedacht)
- Keine `search.html`/`detail.html` — nicht versucht.
