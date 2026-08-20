# Speicher-Endpunkt und Prüfkette

Type: grilling
Status: resolved
Blocked by: 01

## Question

Heute gibt es nur lesende Config-Endpunkte (`GET /api/settings`,
`GET /api/scrape/sources`). Zu entscheiden:

- **Schnitt der API**: ein `PUT /api/config/:datei`, zwei eigene Endpunkte, oder ein
  `POST /api/config` das beide Dateien zusammen schreibt?
- **Wo läuft die Prüfung** — im Browser, im Server, oder beidseits? Der Server ist die
  letzte Instanz, aber der Nutzer braucht die Rückmeldung beim Tippen.
- **Wie wird geschrieben?** `JsonStore` benutzt schreiben-nach-temp-dann-umbenennen für
  Job-Dateien; die Config wird heute nirgends geschrieben. Gilt dasselbe Muster?
- **Kollision mit einem laufenden Scrape**: `loadSources()` wird pro Nutzung frisch gelesen,
  ein Lauf könnte also mitten drin eine geänderte Datei sehen. Egal, sperren, oder warnen?
- **Formatierung**: Die Dateien sind heute von Hand formatiert (`location.json` hat
  mehrzeilige Arrays). Ein `JSON.stringify(…, 2)` formatiert sie um und macht jeden
  git-diff unlesbar. Hinnehmen oder erhalten?

## Answer

**Ein `PUT` pro Datei**, passend zu den bestehenden Einzel-Endpunkten (`/api/attachment`,
`/api/cc`):

```
GET  /api/config/sources    PUT  /api/config/sources
GET  /api/config/location   PUT  /api/config/location
```

Unbekannter Name → 404, keine generische Erlaubnisliste. Kommen später weitere Dateien
dazu (`settings.json` liegt im Nebel der Karte), kostet das je einen Endpunkt — billiger als
eine Verallgemeinerung, die der aktuelle Umfang nicht braucht.

**Geprüft wird beidseits.** Im Browser für die Rückmeldung beim Tippen, im Server als letzte
Instanz — der Server darf sich nicht darauf verlassen, dass die Anfrage aus dem eigenen
Formular kam.

**Geschrieben wird nach dem Muster von `JsonStore`**: in eine temporäre Datei, dann
umbenennen. Ein abgebrochener Schreibvorgang darf keine halbe `sources.json` hinterlassen —
die Datei wird bei jedem Scrape-Lauf frisch gelesen, eine kaputte bricht den nächsten Lauf.

**Zwei Punkte, die ich mangels Gegenfrage so festgelegt habe** — sag, wenn du es anders
willst:

- **Kollision mit einem laufenden Scrape:** kein Sperren. `loadSources()` liest pro Nutzung
  frisch, ein laufender Lauf könnte also mitten drin eine geänderte Datei sehen. Der
  Schaden ist gering (eine Anfrage mehr oder weniger in einem Lauf), der Aufwand für eine
  Sperre steht dazu in keinem Verhältnis. Die Seite weist beim Speichern während eines
  Laufs darauf hin.
- **Formatierung:** die vorhandene Handformatierung wird **nicht** erhalten.
  `JSON.stringify(…, 2)` schreibt beide Dateien neu; `location.json` verliert dabei seine
  mehrzeiligen Arrays. Einmalig ein großer Diff, danach stabil — der Aufwand, die
  Formatierung zu bewahren, lohnt für zwei Dateien nicht.
