# Wo die Seite in der Oberfläche sitzt

Type: grilling
Status: resolved

## Question

Die Seitenleiste hat heute drei Gruppen: Ordner (Jobs, Entwürfe, …), einen losen Block
(Anhang, CC, Kalender) und „Pipeline" (Scrape, Filter, Duplikate, Anschreiben, Nachfassen).
Views werden über eine einzige `view`-Union in `ui/app.tsx` geschaltet.

Zu entscheiden:

- **Wohin?** Zum losen Block (wie Anhang und CC, die auch Config sind), unter „Pipeline"
  neben Scrape (weil es das Scrapen steuert), oder eine eigene Gruppe „Einstellungen"?
- **Eine Seite oder zwei?** Suche und Umkreis sind zwei Dateien mit zwei Bedeutungen — ein
  Eintrag mit zwei Abschnitten, oder zwei Einträge?
- **Verhalten in der Schublade** (unter 1024px): Die Seite ist ein Formular, kein
  Listen-Detail-Paar. Sie füllt also die einzige Spalte — reicht das, oder braucht sie eine
  eigene Regel?
- **Anhang und CC** sind heute schon Config-Seiten mit eigenem Eintrag. Wird die neue Seite
  ihr Nachbar, oder schluckt sie die beiden später? (Letzteres wäre eine Ausweitung des
  Ziels — hier nur benennen, nicht entscheiden.)

## Answer

**Ein Eintrag namens „Suche", im losen Block neben Anhang, CC und Kalender.**

Der Block enthält bereits zwei Config-Seiten mit eigenem Eintrag (Anhang, CC) — die neue
Seite wird ihr Nachbar, statt eine Gruppe umzuräumen, die täglich benutzt wird. „Pipeline"
bleibt das, was etwas *ausführt*; Einstellen und Ausführen bleiben getrennt.

**Eine Seite, zwei Abschnitte.** Suchgebiet und Umkreis stehen untereinander, weil sie eine
Kette sind: das eine bestimmt, was hereinkommt, das andere, was davon bleibt. Auf zwei
Seiten verteilt, wäre der Zusammenhang genau die Information, die verlorengeht.

**Verhalten in der Schublade** (unter 1024px, seit dem Responsiveness-Umbau): Die Seite ist
ein Formular ohne Listen-Detail-Paar, füllt also die einzige Spalte — dasselbe Muster wie
`.att` bei Scrape und Anschreiben. Sie braucht keine eigene Regel, nur die
`grid-column: 1 / -1`-Behandlung, die dort schon für Pipeline-Ansichten steht.

**Ausdrücklich nicht entschieden:** ob „Suche" später Anhang und CC schluckt. Das wäre eine
Ausweitung des Ziels dieser Karte und gehört, wenn überhaupt, in eine eigene.
