# Formular und Roh-JSON — wer gewinnt

Type: grilling
Status: resolved
Blocked by: 01

## Question

Zwei Wege in dieselbe Datei. Zu entscheiden:

- **Ein Textfeld pro Datei, oder eines für beide?** `sources.json` und `location.json` sind
  getrennte Dateien mit getrennter Bedeutung.
- **Wann liest das Formular neu?** Beim Aufklappen? Nach dem Speichern des Textfelds? Live?
- **Was ist die Quelle der Wahrheit, solange beide offen sind?** Tippt jemand ins Textfeld
  und dann ins Formular, gewinnt was?
- **Was zeigt das Textfeld bei ungültigem JSON** — den kaputten Text stehenlassen (damit man
  ihn reparieren kann) oder auf die letzte gültige Fassung zurückspringen?
- **Darf das Textfeld Dinge speichern, die das Formular nicht ausdrücken kann** — ein
  unbekannter Schlüssel, ein Portal ohne Schema? Wenn ja, was macht das Formular danach
  damit?

## Answer

**Das Roh-JSON ist eine Ansicht, kein zweiter Editor.** Aufgeklappt zeigt es
schreibgeschützt, was das Formular gerade hält, mit einem Kopieren-Knopf. Geschrieben wird
ausschließlich über das Formular.

Damit lösen sich alle vier Teilfragen des Tickets auf, statt beantwortet zu werden:

- **Ein Textfeld pro Datei oder eines für beide** — je Abschnitt eines, weil es die Ansicht
  des jeweiligen Abschnitts ist.
- **Wann liest das Formular neu** — nie, es ist die Quelle.
- **Wer gewinnt** — es gibt keinen Konflikt.
- **Ungültiges JSON im Textfeld** — kann nicht entstehen.
- **Dinge, die das Formular nicht ausdrücken kann** — sichtbar (das JSON zeigt alles), aber
  nur außerhalb der App änderbar. Für den einen Fall, der real vorkommt — ein unbekannter
  Schlüssel aus einem Handedit — gibt es stattdessen den Hinweis aus *Wohin die Warnung des
  Adapters geht*, inklusive Reparieren-Knopf.

**Das weicht von Entscheidung 3 des Abstecken-Gesprächs ab**, die von „beide schreiben
dieselbe Datei" ausging. Die Notes der Karte sind entsprechend berichtigt. Grund für die
Abweichung: der Notausgang war für Fälle gedacht, die das Formular nicht kann — und die
gibt es nach *Schema pro Portal* nicht mehr, weil das Schema vollständig beschreibt, was ein
Portal annimmt.
