# Karte: Einstellungsseite für Suche und Umkreis

Label: `wayfinder:map`

## Destination

Eine abgestimmte Spezifikation für eine Einstellungsseite in der JoBBoT-UI, mit der
`config/sources.json` und `config/location.json` angezeigt und geändert werden können —
Formular als Normalfall, Roh-JSON als aufklappbarer Notausgang, mit Schema- und
Formatprüfung beim Speichern. Bedienbar ohne JSON-Kenntnisse und auf einem Handy.

Die Karte ist fertig, wenn nichts mehr zu entscheiden ist, bevor jemand die Seite baut.
**Gebaut wird hier nicht** — diese Karte plant.

## Notes

**Domäne.** JoBBoT ist eine lokale Bewerbungs-Automation (scrape → filter → generate →
review/send). Config liegt als JSON in `config/`. Die UI ist eine React-Datei
(`ui/app.tsx`, ~2500 Zeilen) über einem handgeschriebenen Node-Server
(`scripts/ui-server.ts`).

**Skills je Sitzung.** `/grilling` und `/domain-modeling` als Standard, `/prototype` für
die Formular-Tickets. Fakten im Code nachschlagen statt erfragen.

**Beim Abstecken festgelegt** (nicht mehr zur Disposition, ohne das Ziel neu zu zeichnen):

1. **Config-Editor, kein zweiter Mandant.** Eine Instanz, Kevins Profil. Der Homie auf der
   Baustelle ist der Maßstab für „bedienbar", nicht ein zweiter Nutzer.
2. **Umfang: `sources.json` + `location.json`.** `settings.json`, `experience-rules.json`
   und `profile.json` sind bewusst draußen.
3. **Formular + aufklappbares Roh-JSON.** ~~Beide schreiben dieselbe Datei.~~
   **(berichtigt beim Auflösen von „Formular und Roh-JSON")**: Das JSON ist eine
   schreibgeschützte Ansicht. Der Notausgang war für Fälle gedacht, die das Formular nicht
   kann — die gibt es nach „Schema pro Portal" nicht mehr.
4. **localhost bleibt localhost.** Kein Netzwerk, kein Passwort, kein Hosting.
5. **Schema- plus Formatprüfung beim Speichern.** Kein Probelauf gegen die Portale.
   (Die Begründung hat sich beim Auflösen von „Schema pro Portal" verschoben — die
   Formatprüfung schützt LinkedIn/AMS vor Slugs, nicht umgekehrt. Die Entscheidung
   selbst steht.)

**Fakten, die schon feststehen** (nachgeschlagen, nicht zu erfragen):

- **Kein Neustart nötig.** `loadSources()` wird in `ui-server.ts` bei jeder Nutzung frisch
  gelesen (Zeilen 359, 487); `buildScrapeSetup()` lädt `location.json` bewusst pro Lauf neu
  und begründet das im Kommentar. Beide Dateien sind live editierbar.
- **`SourceQuery` ist `Record<string, string>`** (`lib/sources.ts`) — völlig untypisiert.
  Fünf Portale, vier Schlüsselsätze: `keyword` (karriere.at, jobs.at), `params`
  (devjobs.at), `keyword`+`location` (linkedin), `keyword`+`location`+`vicinity` (ams).
- **Derselbe Schlüssel, zwei Formate — aber nur in eine Richtung gefährlich.**
  ~~Falsches Format → still null Treffer~~ **(berichtigt beim Auflösen von
  „Schema pro Portal")**: karriere.at (`scrapers/karriere-at.ts:63`) und jobs.at
  (`scrapers/jobs-at.ts:121`) slugifizieren das Suchwort selbst, natürliche Sprache
  funktioniert dort also. LinkedIn und AMS `encodeURIComponent` dagegen den Rohstring —
  ein dort eingetragener Slug sucht wörtlich nach Bindestrichen. Die beiden
  Slug-Funktionen sind zudem verschieden (siehe Ticket „Zwei Slug-Funktionen").
- **Die Dreiteilung in `location.json` ist dekorativ.** `lib/location.ts:13` prüft gegen
  `[...cities, ...regions, ...remote]` als eine Liste; kein Code liest die Gruppen getrennt.
- **`COUNTRY_ONLY` ist eine scharfe Kante.** `lib/location.ts:6` vergleicht
  `österreich`/`austria`/`at` **exakt**. Dieselben Wörter als Region eingetragen greifen
  über den Substring-Pfad und hängen den Umkreisfilter praktisch aus.
- **Das stille Versagen sitzt am Schlüssel, nicht am Wert.** Jeder Adapter liest nur, was
  er kennt: `const keyword = query.keyword ?? ''; if (!keyword) continue;`. Ein Tippfehler
  im Schlüsselnamen wirft die Anfrage kommentarlos weg.
- **„Ort" ist zweideutig.** `location` in der Suchanfrage (was das Portal sucht) vs.
  `config/location.json` (Nachfilter, reiner Substring-Vergleich über cities+regions+remote
  in `isInRange`).
- **`ams` steht auf `enabled: false`.**
- **Unter 1024px ist die Seitenleiste eine Schublade** (seit dem Responsiveness-Umbau vom
  2026-08-19). Jede neue Seite muss dort funktionieren.

## Decisions so far

<!-- eine Zeile je geschlossenem Ticket -->

- [Schema pro Portal — wo lebt es, wie sieht es aus](issues/01-schema-pro-portal.md) —
  `querySchema` als Pflichtfeld am `ScraperAdapter`; die Registry ist die Wahrheit über die
  Portalliste (`/api/scrape/sources` liefert künftig aus ihr, nicht aus der Datei);
  `SourceQuery` wird typisiert; Durchsetzung zweistufig — UI verhindert, Adapter warnt
  statt still zu überspringen.
- [„Ort" bedeutet zweierlei — Begriffe trennen](issues/02-ort-entwirren.md) —
  zwei Begriffe nach ihrer Stufe benannt: **Suchgebiet** (geht ans Portal, nur linkedin und
  ams) und **Umkreis** (`location.json`, wirkt nach dem Scrapen auf alle fünf Quellen). Die
  drei Gruppen bleiben unverändert — keine Migration. Inhaltlich geprüft wird genau eine
  Eingabe: „Österreich" als Region wird gewarnt, aber zugelassen. Der Abgleich Suchgebiet↔
  Umkreis ist abgelehnt.
- [Wie die Seite konkret aussieht](issues/03-formular-prototyp.md) — die Form folgt der
  Feldzahl, nicht dem Portal: ein Feld → Chips, mehrere → beschriftete Zeile. Entschieden
  wird das aus dem `querySchema`, nicht per Sonderregel. Deaktivierte Portale bleiben
  sichtbar.
- [Formular und Roh-JSON — wer gewinnt](issues/04-formular-vs-rohjson.md) — das JSON ist
  eine schreibgeschützte Ansicht mit Kopieren-Knopf. Damit entfällt der Konflikt, statt
  gelöst zu werden.
- [Speicher-Endpunkt und Prüfkette](issues/05-speichern-und-pruefkette.md) — ein `PUT` je
  Datei, Prüfung beidseits, Schreiben per temp-dann-umbenennen. Kein Sperren bei laufendem
  Scrape; die Handformatierung der Dateien geht einmalig verloren.
- [Rückweg, wenn ein Speichern etwas kaputt macht](issues/06-rueckweg.md) — vorherige
  Fassung als `<datei>.bak` plus „Letzte Fassung zurückholen". Eine Stufe; alles Ältere
  holt git.
- [Wo die Seite in der Oberfläche sitzt](issues/07-platz-in-der-ui.md) — ein Eintrag
  „Suche" im losen Block neben Anhang und CC. Eine Seite, zwei Abschnitte, weil sie eine
  Kette sind.
- [Zwei Slug-Funktionen — eine daraus machen?](issues/08-slug-funktionen.md) — karriere.at
  ist gegenüber Umlauten nachweislich gleichgültig (630+ Treffer für beide Schreibweisen).
  Vereinheitlicht wird trotzdem, wegen der 40-Zeichen-Kürzung: neue `searchSlug()` ohne
  Längengrenze, ein Formatbezeichner statt zwei.
- [Wohin die Warnung des Adapters geht](issues/09-wohin-die-warnung.md) — CLI-Zeile plus
  Hinweis mit Reparieren-Knopf auf der Einstellungsseite. Der Scrape-Lauf bekommt keinen
  dritten Zustand.
- [COUNTRY_ONLY — Code oder Config?](issues/10-country-only.md) — bleibt Konstante; die
  Seite importiert sie nur, um zu warnen. Editierbar gemacht würde `"at"` als Substring zur
  Falle.

## Not yet specified

- Ob `settings.json` (filterMode, filterModel) doch auf die Seite kommt. Beim Abstecken
  abgewählt, obwohl der ursprüngliche Wunsch genau damit anfing — kann zurückkommen, sobald
  das Formular-Muster steht und die Kosten sichtbar sind.
- Ob `experience-rules.json` überhaupt verantwortbar editierbar ist. Braucht vermutlich eine
  Vorschau („diese Änderung hätte X von Y Jobs anders bewertet"), sonst verstellt man den
  Filter blind. Eigene Frage, sobald es die Seite gibt.
- Ob ein „Begriff testen"-Probelauf gegen die Portale nachgerüstet wird. Heute abgewählt
  wegen Netzaufruf und Browser-Start. Der ursprüngliche Anlass — die Slug-Falle — hat sich
  als unbegründet erwiesen; als Rückmeldung „liefert dieser Begriff überhaupt etwas" bleibt
  die Idee aber sinnvoll.

## Out of scope

- **Zweiter Mandant.** Eigenes Profil, eigenes Gmail, getrennte Job-Daten für den Homie.
  Fixiert durch Entscheidung 1.
- **Netzwerkzugang.** Bind-Adresse, HTTPS, Passwort, Hosting. Fixiert durch Entscheidung 4.
- **`profile.json` bearbeiten** — und damit auch das Neustart-Problem, das nur diese Datei
  hat (`ui-server.ts:37` liest sie einmal beim Start). Fixiert durch Entscheidung 2.


## Status

**Karte abgeschlossen am 2026-08-19.** Alle zehn Tickets aufgelöst, nichts mehr offen — die
Seite ist entschieden und kann gebaut werden. Was noch im Nebel steht, gehört zu einer
späteren Karte, nicht zu dieser.
