# FINDINGS — breite IT-Kategorie pro Seite (Retrieval-Umbau Recon)

Recon only, kein Adapter/Filter/`config/sources.json` geändert. UA:
`Mozilla/5.0 (compatible; JobBot/0.1; +local)`, ~2s Abstand, 10s Timeout.

## Übersicht

| Seite | breite IT-Kategorie? | URL-Muster | Pagination | Ort in Karte? | grobe Anzahl OÖ | Empfehlung |
|---|---|---|---|---|---|---|
| karriere.at | **Ja** | `/jobs/it/{ortSlug}` (z.B. `/jobs/it/linz`) | `?page=n`, funktioniert sauber, mehrere Seiten getestet | Ja — `jobsItem.locations[].name` | **607** (aus `jobsListHeader.count`, nicht geschätzt) | **Kategorie-Pull** |
| jobs.at | **Ja, aber limitiert** | `/j/-/{ortSlug}?jobField[]=19` ("IT, Software & Telekommunikation") | Kaputt wie beim Keyword-Pfad — `?page=`/`?p=`/`?offset=` liefern 301/ignoriert, nur ~15 Treffer erreichbar | Ja — `data-job-location` | ~15 erreichbar (IT-spezifische Gesamtzahl für Linz unbekannt, da Pagination technisch nicht erreichbar; Seite selbst zeigt nur "250+ Jobs in Linz" gesamt, nicht IT-gefiltert) | **Kategorie-Pull** statt Keyword-Liste (weniger Pflege), Limit ~15/Region bleibt bestehen wie vorher |
| devjobs.at | entfällt — ist bereits ein reines Dev-Board | `/jobs/search?jobLevel=junior-job-level` | unbekannt (Vercel-WAF blockt jeden Plain-Fetch, 429) | Ja (laut vorheriger Recon, `metaOsmLocations[0].title`) | unbekannt (Bot-Schutz, kein neuer Versuch unternommen) | Kein Kategorie-Umbau nötig — Site selbst ist die Kategorie |

## karriere.at

1. **Breite Kategorie-URL:** Ja, `/jobs/it` (Austria-weit, laut Subagent >1000 Treffer) bzw. `/jobs/it/linz` mit Ortsfilter. Folgt demselben Muster wie die bisherigen Keyword-URLs (`/jobs/{slug}/{ortSlug}`), nur dass `it` selbst schon breit ist statt eines engen Keywords wie `junior-developer`.
2. **Kombinierbar mit Ort:** Ja, `/jobs/it/linz` funktioniert direkt, gleiches URL-Schema wie bisher.
3. **Pagination:** `?page=n` (nicht `?seite=n` wie in der älteren karriere.at-Recon dokumentiert — ggf. hat sich das URL-Schema geändert oder beide funktionieren parallel, hier nicht weiter verifiziert). Seite 1–3 getestet, unterschiedliche Job-IDs pro Seite bestätigt, 17 Jobs/Seite, kein Abbruch erkennbar.
4. **Grobe Anzahl OÖ:** 607 Jobs für `linz` (direkt aus `jobsSearchList.jobsListHeader.count` im `VUE_INITIAL_STATE`, in der Fixture verifiziert: `"count":"607"`, Titel-Tag `"IT Jobs in Linz | aktuell 600+ offen"`).
5. **Ort in Karte:** Ja, identisch zur bestehenden Keyword-Suche (`jobsItem.locations[].name`).

Fixture: `test/fixtures/karriere-at/category.html` (`/jobs/it/linz`, Seite 1).

## jobs.at

1. **Breite Kategorie-URL:** Ja — echte Berufsfeld-Taxonomie existiert, keine Notlösung über einen breiten Keyword-Slug. Filter `jobField[]=19` = "IT, Software & Telekommunikation", auffindbar über die Berufsfelder-Checkbox auf der Suchseite (`/j`). Das ist klar von dem in der letzten Recon dokumentierten, Session-unabhängigen Keyword-Pfad (`/j/{keyword-slug}`) zu unterscheiden — hier handelt es sich um einen echten Query-Parameter-Filter, keinen Pfad-Suchbegriff.
2. **Kombinierbar mit Ort:** Ja — `/j/-/linz?jobField[]=19` funktioniert (Pfad-Ort + Query-Kategorie kombiniert, anders als die 404-Kombination `/j/{kw}/-/{ort}` aus der letzten Recon). Kein spezifischer Bundesland-Slug für "Oberösterreich" gefunden, Linz als Ort ist die praktikable Wahl.
3. **Pagination:** Gleiches kaputtes Muster wie beim Keyword-Pfad — `?page=2` → 301 (aktiv entfernt), `?p=`/`?offset=` werden ignoriert (byte-identische Ergebnisse). Nur ~15 Treffer pro Plain-Fetch erreichbar, Rest läuft über Client-JS-Infinite-Scroll.
4. **Grobe Anzahl OÖ:** Nicht sauber ermittelbar — die Seite zeigt nur eine ungefilterte Gesamtzahl ("250+ Jobs in Linz", alle Berufsfelder), keine IT-spezifische Zählung im HTML gefunden. Real erreichbar bleiben ~15 Treffer pro Plain-Fetch, wie beim Keyword-Pfad.
5. **Ort in Karte:** Ja, identisch zur bestehenden Keyword-Suche (`data-job-location`).

Fixture: `test/fixtures/jobs-at/category.html` (`/j/-/linz?jobField[]=19`).

**Konsequenz für jobs.at:** Die Kategorie ersetzt sinnvoll die Notwendigkeit, mehrere Keyword-Slugs zu pflegen (ein sauberer, dokumentierter Filter statt Keyword-Raten), löst aber das ~15-Treffer-Limit pro Region nicht — das bestand vorher genauso.

## devjobs.at (nur Einordnung, kein neuer Fetch)

Bleibt laut vorheriger Recon (`test/fixtures/devjobs-at/FINDINGS-devjobs.md`) ein reines Entwickler-Jobboard — keine Support-, Admin- oder Lehre-Stellen im Scope der Plattform selbst. Eine "breite IT-Kategorie" ist hier kein zusätzlicher Filter, sondern die Site-Auswahl selbst deckt das schon ab. `jobLevel=junior-job-level` filtert weiterhin auf Einsteiger-Niveau. Kein Kategorie-Umbau nötig; offenes Problem bleibt ausschließlich der Vercel-WAF-Bot-Schutz (429 auf jeden Plain-Fetch), unverändert seit letzter Recon.

## Empfehlung — Satz für den Retrieval-Umbau

**Für Retrieval-Umbau nutzen wir: karriere.at → Kategorie-Pull `/jobs/it/{ort}` mit `?page=n`-Pagination (607 Jobs Linz, sauber paginierbar); jobs.at → Kategorie-Pull `/j/-/{ort}?jobField[]=19` statt Keyword-Liste (sauberer Filter, aber weiterhin ~15-Treffer-Limit/Region wegen kaputter Pagination — ggf. mit mehreren Ortsslugs in OÖ kombinieren, um mehr Abdeckung zu bekommen); devjobs.at → bleibt unverändert (`jobLevel=junior-job-level`), ist bereits die Kategorie, Bot-Schutz weiterhin ungelöst (Playwright oder skip, siehe alte Recon).**

## Fixtures

- `test/fixtures/karriere-at/category.html` (`/jobs/it/linz`, Seite 1, 347 KB)
- `test/fixtures/jobs-at/category.html` (`/j/-/linz?jobField[]=19`, 465 KB)
- devjobs.at: kein neuer Fetch, keine neue Fixture (Bot-Schutz unverändert, siehe alte Recon)

## Definition of Done — Status

- [x] Kernfragen je Seite beantwortet (karriere.at, jobs.at je 5, devjobs.at aus Bestandsrecon eingeordnet)
- [x] Je 1 Kategorie-Fixture gesichert (karriere.at, jobs.at) — devjobs.at bewusst ausgelassen, kein Fetch nötig laut Task
- [x] Kein Code außer Recon-`curl`-Aufrufen der Subagents (nicht committed)
- [x] Kein neues Runtime-Dep, kein Adapter, kein Filter-Umbau, `config/sources.json` unverändert
