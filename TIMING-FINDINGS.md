# Scrape Timing Findings

Mess-Lauf: devjobs.at Seite 1 + 3 Details, karriere.at 1 Keyword + 3 Details.
Datum: 2026-06-30

---

## devjobs.at — Einzelwerte (gemessen)

| Schritt | search-p1 | detail-1 | detail-2 | detail-3 |
|---------|-----------|----------|----------|----------|
| browser-launch | 87ms | 57ms | 56ms | 55ms |
| context-create | 63ms | 41ms | 38ms | 39ms |
| goto-networkidle | 1376ms | 2635ms | 1790ms | 3316ms |
| poll-state | **3331ms (17 iter)** | 30ms (1) | 25ms (1) | 29ms (1) |
| extract | 44ms | 13ms | 12ms | 12ms |
| browser-close | 39ms | 21ms | 18ms | 21ms |
| **total-fetch** | **4898ms** | **2786ms** | **1926ms** | **3461ms** |
| delay (davor) | — | 2002ms | 2002ms | 2001ms |

**Auffälligkeit:** poll-state auf der **Search-Seite braucht 3331ms (17 Iterationen)**,
auf Detail-Seiten dagegen nur 1 Iteration (~28ms). Der Streaming-SSR-State der
Search-Seite trifft deutlich nach networkidle ein.

---

## devjobs.at — Hochrechnung (15 Seiten, 215 Jobs)

| Phase | pro Einheit | Anzahl | Gesamt |
|-------|------------|--------|--------|
| Delay (15 Seiten) | 2000ms | 14 | 28s |
| goto-networkidle (Seiten) | ~2280ms avg | 15 | 34s |
| poll-state (Seiten) | ~3330ms | 15 | 50s |
| Browser-Lifecycle (Seiten) | ~230ms | 15 | 3s |
| **Search-Phasen gesamt** | | | **~115s** |
| Delay (Detail-Fetches) | 2000ms | 215 | 430s |
| goto-networkidle (Details) | ~2580ms avg | 215 | 555s |
| poll-state (Details) | ~28ms | 215 | 6s |
| Browser-Lifecycle (Details) | ~120ms | 215 | 26s |
| **Detail-Phasen gesamt** | | | **~1017s** |
| **Gesamtschätzung** | | | **~1132s ≈ 19 min** |

Deckt sich mit dem empirisch beobachteten ~13-17 min Lauf.

---

## karriere.at — Einzelwerte (gemessen)

| Schritt | 1 Keyword | detail-1 | detail-2 | detail-3 |
|---------|-----------|----------|----------|----------|
| search-fetch | 430ms | — | — | — |
| detail-fetch (inkl. 2s delay) | — | 2344ms | 2207ms | 2251ms |
| netto HTTP-Zeit (detail) | — | ~344ms | ~207ms | ~251ms |

**Erkenntnis:** karriere.at nutzt plain HTTP-Fetch, kein Playwright.
Echter Fetch-Overhead pro Detail: ~267ms. Die 2s-Delays machen 88% der Detail-Zeit aus.

### karriere.at Hochrechnung (6 Keywords, ~60 unique Jobs nach Dedup)

| Phase | pro Einheit | Anzahl | Gesamt |
|-------|------------|--------|--------|
| search-fetch | 430ms | 6 | 3s |
| Delay (Details) | 2000ms | 60 | 120s |
| netto Detail-Fetch | 267ms | 60 | 16s |
| **Gesamt** | | | **~140s ≈ 2.3 min** |

karriere.at ist durch plain HTTP kein Performance-Problem.

---

## Wo frisst devjobs.at die Zeit? (Anteile)

| Kostenträger | Anteil an Gesamtzeit |
|--------------|---------------------|
| goto-networkidle (Detail-Fetches) | 589s / 1132s = **52%** |
| delay (Detail-Fetches) | 430s / 1132s = **38%** |
| poll-state (Search) + goto (Search) | 84s / 1132s = **7%** |
| Browser-Lifecycle | 29s / 1132s = **3%** |

**Kernbefund:** goto-networkidle + delays auf den Detail-Seiten
fressen 90% der Laufzeit. Die meisten dieser Detail-Fetches sind für
Jobs außerhalb OÖ — und damit nutzlos.

---

## Empfehlung: 4 Optimierungen nach ROI gerankt

### 1. Location-Gate vor Detail-Fetch (höchster ROI, null Risiko)

**Einsparung: ~80% der Detail-Fetches.**

Die Search-Seite liefert bereits `location` für jeden Job. Bei einem typischen
devjobs.at-Lauf sind ~80% der Jobs außerhalb OÖ (empirisch: 53/66 bei karriere.at).
Wenn wir `isInRange()` auf das baseJobs-Array anwenden, BEVOR detail-fetches
gestartet werden, schrumpft die Detail-Liste von 215 auf ~43 Jobs.

Einsparung: 172 × (2000ms delay + 2580ms goto + ...) ≈ **820s ≈ 14 min**
Neue Gesamtschätzung: 1132s − 820s ≈ **312s ≈ 5 min**

Implementierung: in `scrape()` nach Sammeln aller baseJobs,
`baseJobs.filter(j => isInRange(j.location ?? '', locCfg))` vor der Detail-Schleife.
(locCfg per Callback injizieren oder in Adapter laden.)

### 2. Browser-Reuse (mittlerer ROI, gering komplex)

**Einsparung: ~55ms pro Fetch → ~13s auf 230 Fetches.**

Einen einzigen Browser für den gesamten `scrape()`-Aufruf offen halten,
statt pro `fetchRemixContext()` zu starten/stoppen. Spart browser-launch,
context-create, browser-close (~139ms/Fetch) und erlaubt möglicherweise
DNS/TCP-Reuse innerhalb Chromium.

Zusätzlicher Vorteil: Kein paralleler Browser-Start-Overhead wenn
zukünftig parallelisiert wird.

Implementierung: `browser`-Instanz als Parameter oder Closure in `scrape()`.

### 3. `waitUntil: 'domcontentloaded'` statt `'networkidle'` (unsicher)

**Erwartete Einsparung: unklar — muss getestet werden.**

Search-Seite: networkidle(1376ms) + poll(3331ms) = 4707ms total.
Mit domcontentloaded: DOM lädt schneller, aber Streaming-SSR-Script
trifft möglicherweise noch später ein → poll dauert länger.
**Net-Effekt unbekannt, Risiko: State kommt nie an.**

Detail-Seiten: networkidle(~2580ms) + poll(~28ms) = 2608ms.
Mit domcontentloaded könnte goto kürzer sein und poll noch 1 iter bleiben.
Muss gemessen werden bevor implementiert.

**Empfehlung: erst nach Opt 1+2 messen.**

### 4. Delays reduzieren (moderate Einsparung, Rate-Limit-Risiko)

**Einsparung: 1500ms × 229 Delays = 344s ≈ 6 min (bei 500ms statt 2000ms).**

Risiko: devjobs.at könnte bei schnellerer Abfolge von Playwright-Requests
als Bot erkennen und blockieren. Aktuell kein WAF-Problem; das ist ein
bewusstes Throttling.

**Empfehlung: erst implementieren wenn Opt 1 allein nicht reicht.**

---

## Priorität für nächsten Prompt

```
1. Location-Gate vor Detail-Fetch (Opt 1) — sofort, ~14 min Ersparnis
2. Browser-Reuse (Opt 2)               — danach, ~13s + Architektur-Bonus
3. domcontentloaded testen (Opt 3)     — nach Mess-Lauf mit Opt 1+2
4. Delay-Reduktion (Opt 4)             — nur wenn nötig
```
