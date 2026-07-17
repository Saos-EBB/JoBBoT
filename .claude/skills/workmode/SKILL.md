---
name: workmode
description: >
  Mode-Skill: schaltet für die restliche Session drei Regeln scharf — YAGNI (nur
  bauen was verlangt wurde, weggelassenes protokollieren), Steps (ein Commit pro
  logischem Step, kein Push, bei Fehler stoppen) und Doku (docs/ wächst im selben
  Commit mit). Verwende diesen Skill immer wenn der User "/workmode", "/workmode
  off", "workmode an", "workmode aus", "workmode status" schreibt, fragt ob workmode
  läuft, oder sinngemäß sagt "sauber und nachvollziehbar, nichts dazuerfinden".
  Einmal an, gilt er für JEDEN weiteren Prompt der Session — nicht nur für den, der
  ihn eingeschaltet hat.
---

# workmode

An = drei Regeln, für alles was danach kommt:

- **YAGNI** — nur bauen was verlangt wurde. Der Rest ist Code den du morgen debuggst und nie brauchst.
- **Steps** — ein Commit pro logischem Step. Jeder Punkt der Session bleibt erreichbar.
- **Doku** — `docs/` wächst mit, im selben Commit. Doku die hinterher geschrieben wird, wird nicht geschrieben.

## Schalter

Ein geteilter State-File für alle Mode-Skills: `.claude/mode.state`. Der Inhalt ist
der Name des aktiven Modus (`workmode`, später z.B. `reviewmode`) — nie mehr als
einer gleichzeitig. Einschalten überschreibt, was vorher drinstand, ohne
Sonderfallbehandlung: die Datei kennt immer nur den einen aktuellen Wert.

| Sagt der User | Tu das | Melde |
|---|---|---|
| `/workmode`, "workmode an" | `mkdir -p .claude && printf workmode > .claude/mode.state` | die drei Regeln oben, einzeilig, mit 🟢. War vorher ein anderer Modus aktiv: welcher abgelöst wurde |
| `/workmode off`, "workmode aus" | nur löschen wenn der Inhalt `workmode` ist: `[ "$(cat .claude/mode.state 2>/dev/null)" = workmode ] && rm -f .claude/mode.state` | `⚪ workmode aus.` |
| "läuft workmode?" | `cat .claude/mode.state 2>/dev/null` | ob der Inhalt `workmode` ist — nicht bloß ob die Datei existiert, ein anderer Modus könnte aktiv sein |

Der grüne Badge in der Statusline liest denselben State-File. Kommt er nicht:
`references/setup.md` — dort steht die einmalige Einrichtung.

Steht `workmode` schon in der Datei, der Mode in dieser Session aber noch nie
angesagt: Regeln ansagen und ab da befolgen. Das ist der Normalfall am
Sessionanfang.

---

## Regel 1 — YAGNI

Bau was im Prompt steht. Nichts daneben.

**Kandidaten zum Weglassen:** Abstraktion für genau eine Implementierung (Interface,
Basisklasse, Generic) · Config-Option oder Flag das niemand setzt · Fehlerbehandlung
für einen Fall der nicht eintritt · `try/catch` das nur rethrowt · Null-Check auf
etwas das nicht null wird · Helper der einmal aufgerufen wird · neue Datei wenn die
Funktion in eine bestehende passt · alles "für später": Hook, Platzhalter,
auskommentierter Code, `// TODO`.

Wenn du denkst „das brauchen wir später sicher" — du weißt es nicht. Später ist
billiger, weil du dann weißt was du brauchst. **Löschen statt auskommentieren**, git
hat den Code.

### Fragen oder notieren

Es juckt dich, mehr zu bauen. Was jetzt passiert, hängt an der Reichweite:

- **Bleibt lokal** — Helper, Null-Check, eine Datei: nimm die dumme Variante, schreib
  eine Zeile ins Gate, lauf weiter. **Nicht fragen.** Eine Rückfrage kostet dich mehr
  als ein Helper zu viel, und der steht dann wenigstens im Log.
- **Zwingt andere Dateien mitzuziehen** — neue Dependency, geänderter Vertrag zwischen
  Modulen, gelöschtes öffentliches Ding: **fragen, bevor du's tust.**
- **DB-Migration** — immer fragen. Das Einzige was git nicht zurückholt sind Daten.

### Das Gate

Vor jedem Step eine Zeile: was war naheliegend, wird aber nicht gebaut.

```
Step 2: MailComposer einbauen
Nicht gebaut: kein Attachment-Interface (ein Slot, eine Impl), kein Mimetype-Check
```

Ohne die Zeile ist YAGNI nicht überprüfbar — man sieht nur was da ist, nie was du
dir verkniffen hast. Sie wandert in den Build-Log. War nichts wegzulassen:
`Nicht gebaut: —`.

Verlangt der User etwas das gegen YAGNI geht: **bau was er sagt.** Einmal kurz sagen
was du weglassen würdest, dann ist gut. Er entscheidet.

---

## Regel 2 — Steps

Ein Step = eine abgeschlossene, testbare Einheit. Nicht pro Funktion, nicht acht
Dateien am Stück.

Vorher die geplanten Steps als kurze Liste ansagen. Dann pro Step:

1. Gate ansagen (`Nicht gebaut: …`)
2. Code
3. `docs/` nachziehen
4. `git status` → `git add -A` → commit
5. `✅ Step N/X committed: "<message>"` → was als nächstes kommt

Commit-Format: `<type>(<scope>): <was dieser Step gemacht hat>`, Types
`feat | refactor | fix | chore | delete`. Beispiel:
`refactor(notifications): update BeefService to use domain methods`

- **Kein `git push`.** Nie, auch nicht am Ende, auch nicht wenn alles grün ist.
- Step N+1 erst anfangen wenn N committed ist.
- Kein leerer Commit — `git status` prüfen, nicht raten.
- Working Tree dreckig beim Start → melden und nachfragen, nicht mitcommiten.
- **Bei Fehler:** sofort stoppen, Fehler zeigen, nicht auto-fixen.

**Die Naht zu Regel 3:** Doku und Code gehen zusammen in **einen** Commit. Damit nimmt
ein `revert` beides mit und die Doku kann nicht hinterherhinken. Ein Step ohne
Doku-Update ist kein fertiger Step.

---

## Regel 3 — Doku

Ordner `docs/` im Repo-Root. Drei Dateien, mehr nicht. Neue Einträge kommen **oben**
rein. Fehlt eine Datei, leg sie an wenn der Step sie braucht — nicht auf Vorrat, das
wäre Regel 1.

### `docs/build-log.md` — jeder Step

```markdown
## 2026-07-17 — feat(mail): PDF-Anhang an jedem Entwurf
**Was:** MailComposer ersetzt den handgebauten MIME-Builder — der kann nur single-part.
**Nicht gebaut:** kein Multi-Slot-Upload, kein Mimetype-Check. Ein fixer Slot.
```

Zwei Zeilen. Welche Dateien angefasst wurden steht im Diff — schreib das nicht ab.
Der Log trägt was git nicht hat: **warum** es den Step gibt und **was drumherum
nicht gebaut wurde**.

### `docs/errors.md` — wenn was kaputt war

Ein Eintrag pro Fehler der mehr als einen Versuch gekostet hat. Nicht für Tippfehler.

```markdown
## 2026-07-17 — Ollama-Lauf bricht bei langen Inseraten ab
**Symptom:** Generierung hängt, keine Fehlermeldung, Prozess läuft weiter.
**Ursache:** HTML-Reste im `description`-Feld sprengen das Context-Limit.
**Fix:** `stripHtml()` im Scraper vor dem Speichern.
```

Der Wert steckt in **Ursache**. Ist sie unklar, schreib genau das: „Ursache unklar,
Workaround: X". Eine erfundene Ursache kostet dich beim nächsten Auftreten den
ganzen Tag nochmal.

### `docs/architecture.md` — nur bei Strukturänderung

Wird **editiert, nicht angehängt** — aktueller Stand, kein Verlauf.

```markdown
# Architektur
## Überblick        — was das Ding tut, 3-5 Sätze
## Module           — wer macht was, wer ruft wen
## Datenfluss       — nur wenn nicht offensichtlich
## Entscheidungen   — Datum, Entscheidung, Grund. Neue oben.
```

Anfassen nur bei: neues Modul, geänderter Vertrag zwischen Modulen, neue
Abhängigkeitsrichtung, Datenmodell. **Ein Bugfix ändert die Architektur nicht.**
Veraltete Stellen beim Vorbeikommen mitkorrigieren — eine falsche Architektur-Doku
ist schlimmer als keine.

---

Solange workmode läuft, braucht es `/commit` nicht — die Steps commiten sich selbst.
Der Mode gilt bis er ausgeschaltet wird, auch für den Prompt in fünf Nachrichten.
Nicht nach dem ersten erledigten Task stillschweigend zurück in den Normalmodus.
