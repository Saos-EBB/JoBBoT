# Wie die Seite konkret aussieht

Type: prototype
Status: resolved
Blocked by: 01, 02

## Question

Ein wegwerfbarer Prototyp der Seite, an dem sich entscheiden lässt, was in Worten nicht
entscheidbar ist. Nutzt `/prototype`.

Zu zeigen:

- **Portalblock**: Name, An/Aus-Schalter, Liste der Suchanfragen, „+ Suchbegriff".
- **Die vier Anfrage-Formen** aus Ticket 01 nebeneinander — insbesondere devjobs.at
  (`params`, gar kein keyword) und ams (drei Felder), die nicht in dasselbe Chip-Muster
  passen wie karriere.at.
- **Formatwarnung** beim Tippen: „junior developer" bei karriere.at → wird zu
  „junior-developer".
- **Umkreis-Abschnitt** in der aus Ticket 02 beschlossenen Benennung.
- **Zwei Breiten**: 390px (Schublade, ein Finger) und 1440px.

Beantwortet: Sind Chips die richtige Form, oder braucht eine Anfrage mit drei Feldern eine
Zeile statt eines Chips? Wie sieht ein deaktiviertes Portal aus — ausgegraut oder
eingeklappt? Wo sitzt „Speichern": pro Abschnitt, oder einmal unten?

## Answer

Aufgelöst über Skizzen in der Entscheidungsrunde statt über einen gebauten Prototyp — die
Frage war eng genug, dass Bilder zum Draufzeigen gereicht haben.

**Die Form folgt der Feldzahl, nicht dem Portal.**

- **Ein Feld → Chips.** karriere.at, jobs.at (`keyword`) und devjobs.at (`params`) bleiben
  eine kompakte Chip-Wolke mit „+ Suchbegriff". Sieben karriere.at-Begriffe brauchen so eine
  Zeile, nicht sieben.
- **Mehrere Felder → beschriftete Zeile.** LinkedIn (`keyword` + `location`) und AMS
  (`keyword` + `location` + `vicinity`) bekommen eine Tabellenzeile pro Anfrage mit
  Spaltenköpfen. Ein Chip müsste zum Ändern ohnehin aufklappen — dann kann es gleich eine
  Zeile sein.

Welche Form ein Portal bekommt, entscheidet sein `querySchema` (siehe *Schema pro Portal*),
nicht eine Sonderregel je Portalname. Ein künftiges Portal ordnet sich damit von selbst ein.

**Deaktivierte Portale** (heute `ams`) bleiben sichtbar mit ihrem Schalter auf „aus" — nicht
ausgeblendet. Sonst verschwindet die Konfiguration mitsamt dem Weg, sie zurückzuholen.
