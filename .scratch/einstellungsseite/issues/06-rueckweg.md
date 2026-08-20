# Rückweg, wenn ein Speichern etwas kaputt macht

Type: grilling
Status: resolved

## Question

Es gibt heute kein Undo. Wer `sources.json` zerlegt, merkt es beim nächsten Lauf — und hat
die vorherige Fassung nicht mehr, außer sie war committet.

Zu entscheiden:

- **Reicht gar nichts?** `config/` liegt im Repo und ist versioniert; `git checkout` ist der
  Rückweg. Aber der Homie-Maßstab sagt: wer kein Terminal aufmacht, hat keinen Rückweg.
- **Vorherige Fassung als `.bak` neben der Datei?** Billig, eine Stufe tief.
- **Eine Historie der letzten N Fassungen** mit „Zurücksetzen"-Knopf in der UI?
- **Oder vorbeugend statt heilend**: eine Vorschau „was ändert sich" vor dem Speichern,
  sodass es den Rückweg seltener braucht.

Hängt an nichts — kann jederzeit gezogen werden.

## Answer

**Die vorherige Fassung wandert beim Speichern nach `<datei>.bak`**, und die Seite bietet
„Letzte Fassung zurückholen", solange eine existiert.

Eine Stufe tief, mehr nicht. Begründung gegen die beiden Nachbarn:

- **Gegen „gar nichts":** `sources.json` und `location.json` sind zwar versioniert
  (`git check-ignore` bestätigt: nur `profile.json` ist ignoriert), git ist also technisch
  der Rückweg. Aber der Maßstab dieser Karte ist jemand, der kein Terminal aufmacht — für
  den existiert dieser Rückweg nicht.
- **Gegen eine Historie der letzten fünf:** das wäre eine kleine Versionsverwaltung neben
  einem Repo, das schon eine hat. Eine Stufe deckt den Fall ab, der wirklich vorkommt
  („ich hab gerade was kaputtgemacht"); alles Ältere holt git.

`.bak` gehört in `.gitignore` — es ist ein Arbeitsstand, keine Fassung.
