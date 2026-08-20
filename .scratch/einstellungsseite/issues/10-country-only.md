# COUNTRY_ONLY — Code oder Config?

Type: grilling
Status: resolved

## Question

`lib/location.ts:6` hält `['österreich', 'oesterreich', 'austria', 'at']` als hartkodierte
Konstante. Sie ist der Sonderfall im Umkreisfilter: ein Job, dessen Ort **exakt** einer
dieser Werte ist, wird behalten — die Annahme dahinter ist „Ort unbekannt, lieber behalten
und den Menschen entscheiden lassen".

Semantisch ist das Konfiguration, nicht Logik: es beantwortet die Frage „in welchem Land
suche ich", und die steht sonst in `location.json`.

Das wird durch *„Ort" bedeutet zweierlei* akut: Die Seite soll warnen, wenn jemand
„Österreich" als Region einträgt. Dafür muss sie die Liste kennen. Liest sie sie aus dem
Code, ist sie eine dritte Stelle, an der dieselben vier Wörter stehen.

Zu entscheiden:

- **Wandert `COUNTRY_ONLY` nach `location.json`** (als vierte Gruppe, etwa `country`), oder
  bleibt es Code und die UI importiert die Konstante?
- **Wenn es wandert:** Bekommt die Gruppe ein eigenes Feld im Formular, oder bleibt sie
  unsichtbar — sie ist ja keine Einstellung, die man häufig ändert, sondern eher eine
  Landesannahme.
- **Was passiert, wenn jemand sie leert?** Dann fliegen alle Jobs mit unbekanntem Ort raus.
  Braucht das denselben Warnhinweis wie die Österreich-als-Region-Eingabe?
- **Und der Randfall `"at"`:** als Substring wäre das katastrophal (steckt in „Klagenfurt",
  „Bruck an der Mur"). Der exakte Vergleich rettet das heute. Wenn die Liste editierbar
  wird, muss die Seite verhindern, dass jemand `at` in die falsche Gruppe schreibt.

## Answer

**`COUNTRY_ONLY` bleibt eine Konstante in `lib/location.ts`.** Die Einstellungsseite
importiert die Liste, um davor zu warnen (siehe *„Ort" bedeutet zweierlei*) — sie ändert sie
nicht.

Begründung:

- **Es ist keine Einstellung, sondern eine Annahme.** „In welchem Land suche ich" ändert sich
  nicht beim Justieren von Suchbegriffen. Was aussieht wie Konfiguration, ist hier eine
  Konstante der Domäne.
- **Der Randfall `"at"` ist nur deshalb harmlos, weil exakt verglichen wird.** Als Substring
  steckt `at` in Klagenfurt, Bruck an der Mur, Amstetten und Dutzenden weiteren Orten.
  Sobald die Liste editierbar wäre, könnte jemand `at` in die Regionen schreiben — und der
  Umkreisfilter behielte alles. Editierbarkeit würde also erst eine Gefahr schaffen und
  dann Schutzmaßnahmen dagegen verlangen.
- **Die dritte Fundstelle ist der akzeptierte Preis.** Die Wörter stehen dann im Code und
  werden von der UI gelesen — ein Import, keine Kopie. Das ist eine Stelle, nicht zwei.

**Damit entfällt auch die Teilfrage „was, wenn jemand sie leert".** Kann nicht passieren.
