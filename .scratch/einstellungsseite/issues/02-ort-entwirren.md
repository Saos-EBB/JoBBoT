# „Ort" bedeutet zweierlei — Begriffe trennen

Type: grilling
Status: resolved

## Question

Es gibt zwei verschiedene Ortsbegriffe, die heute beide „location" heißen:

1. **Suchort** — `location` innerhalb einer Suchanfrage in `sources.json`. Geht an das
   Portal, bestimmt was gesucht wird. Nur linkedin und ams haben ihn; ams zusätzlich
   `vicinity: "40"` (km).
2. **Umkreisfilter** — `config/location.json` mit `cities` / `regions` / `remote`. Läuft
   NACH dem Scrapen über `isInRange()`, reiner kleingeschriebener Substring-Vergleich über
   alle drei Listen zusammen. Wirft Jobs weg, deren Ort nicht passt.

Ein Formular, das beides „Ort" nennt, lügt. Zu entscheiden:

- **Wie heißen die beiden in der UI?** Vorschlag zum Zerreißen: „Suchort" (geht ans Portal)
  und „Umkreis" (wirft hinterher weg).
- **Gehören sie auf dieselbe Seite?** Sie hängen zusammen — ein Suchort ohne passenden
  Umkreis liefert Treffer, die der Filter sofort wegwirft.
- **Bleiben `cities`/`regions`/`remote` drei getrennte Listen im Formular?** Für `isInRange`
  sind sie eine einzige Liste; die Dreiteilung ist heute rein dokumentarisch.
- **Soll die Seite den Widerspruch sichtbar machen** — etwa: LinkedIn sucht in
  „Oberösterreich", aber „Oberösterreich" steht in `regions`, also passt es?

## Answer

**Die beiden Begriffe heißen nach ihrer Stufe in der Kette: „Suchgebiet" und „Umkreis".**

- **Suchgebiet** — geht an das Portal, bestimmt was gesucht wird. Existiert nur bei
  `linkedin` (`location`) und `ams` (`location` + `vicinity`). Die Seite sagt bei den
  übrigen dreien ausdrücklich „sucht österreichweit", statt das Feld wegzulassen — sonst
  bleibt unerklärlich, warum karriere.at trotzdem gefiltert wird.
- **Umkreis** — `config/location.json`, wirkt **nach** dem Scrapen über `isInRange()` und
  gilt für **alle fünf** Quellen.

Damit ist auch der Grund benannt, warum es zwei sein müssen: sie sitzen an verschiedenen
Stellen der Kette und haben verschiedene Reichweite.

**Die drei Gruppen `cities` / `regions` / `remote` bleiben, wie sie sind.** Technisch sind
sie längst eine Liste — `lib/location.ts:13` macht `[...cfg.cities, ...cfg.regions,
...cfg.remote]` und vergleicht per Substring; kein Code liest die drei je getrennt. Sie
trotzdem zu behalten kostet nichts (keine Migration von `location.json`, kein Anfassen von
`lib/location.ts` und seinen Tests) und erhält die Information, *warum* ein Begriff
drinsteht — „homeoffice" als Ort zu lesen wäre sinnlos. Die Seite schreibt einmal dazu, dass
gegen alle Gruppen zusammen geprüft wird, damit die Gruppierung nicht mehr verspricht als
sie hält.

**Die Seite prüft genau eine Eingabe inhaltlich: die `COUNTRY_ONLY`-Kante.**
`lib/location.ts:6` vergleicht `österreich` / `oesterreich` / `austria` / `at` **exakt** —
damit ein Job, dessen Ort nur „Österreich" ist, nicht wegen fehlender Genauigkeit
rausfliegt. Trägt jemand „Österreich" als **Region** ein, greift stattdessen der
Substring-Pfad, und `isInRange` behält jeden Job mit „…, Österreich" — der Umkreisfilter
ist damit praktisch aus. Das ist die naheliegendste Eingabe überhaupt („ich will ganz
Österreich") und die einzige, die still das ganze Verhalten umdreht.

Die Seite warnt und lässt es dann zu. Kein Blockieren: wer wirklich ganz Österreich will,
soll das dürfen — er soll nur wissen, was er tut.

**Abgelehnt: der Abgleich zwischen Suchgebiet und Umkreis.** Also die Prüfung, ob ein
Portal irgendwo sucht, das der Umkreis danach wegwirft, oder ob ein Umkreis-Begriff
wirkungslos ist, weil ihn kein Portal je sucht. Nützlich, aber spürbar mehr Arbeit, und die
Seite kommt ohne aus. Bleibt als Möglichkeit, nicht als Aufgabe.

**Nicht hier entschieden:** ob Suchgebiet und Umkreis auf *einer* Seite stehen oder auf
zwei. Das gehört zu *Wo die Seite in der Oberfläche sitzt*, das die Frage ausdrücklich
stellt.
