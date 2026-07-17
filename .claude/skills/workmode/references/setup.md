# Einrichtung — einmalig, dann nie wieder

Der Badge kommt aus der Claude-Code-Statusline: ein Script, das bei jeder Antwort
kurz läuft, keine Tokens kostet und nur den Inhalt von `.claude/mode.state` im
Projekt ausliest.

`.claude/mode.state` ist geteilter State für **alle** Mode-Skills, nicht nur
workmode — der Inhalt ist der Name des jeweils aktiven Modus, nie mehr als einer
gleichzeitig. Ein künftiger zweiter Mode-Skill (z.B. `reviewmode`) schreibt in
dieselbe Datei und braucht am Badge-Script nichts zu ändern.

## 1. Ausführbar machen

```bash
chmod +x ~/.claude/skills/workmode/scripts/mode-badge.sh
```

## 2. In `~/.claude/settings.json`

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/skills/workmode/scripts/mode-badge.sh"
  }
}
```

Der Pfad zeigt direkt ins Skill-Verzeichnis — kein zweites Exemplar das veraltet.

**Wenn schon eine Statusline läuft:** die nicht ersetzen. Diese drei Zeilen ins
bestehende Script übernehmen und `$badge` vorne an die Ausgabe hängen:

```bash
project_dir=$(printf '%s' "$input" | grep -o '"project_dir": *"[^"]*"' | head -1 | cut -d'"' -f4)
mode=$(cat "$project_dir/.claude/mode.state" 2>/dev/null)
badge=""
[ -n "$mode" ] && badge="\033[1;32m● $(printf '%s' "$mode" | tr '[:lower:]' '[:upper:]')\033[0m │ "
```

Die Ausgabe muss dann über `printf '%b\n'` laufen, nicht über `echo` — sonst stehen
die Escape-Codes als Text da.

## 3. State-Datei ignorieren

Pro Repo einmal, sonst nimmt `git add -A` sie beim nächsten Step mit:

```bash
echo ".claude/mode.state" >> .gitignore
```

## 4. Testen ohne Claude Code

```bash
mkdir -p /tmp/t/.claude && printf workmode > /tmp/t/.claude/mode.state
printf '%s' '{"cwd":"/tmp/t","model":{"display_name":"Sonnet 4.6"},"workspace":{"project_dir":"/tmp/t"}}' \
  | ~/.claude/skills/workmode/scripts/mode-badge.sh
```

Erwartung: grünes `● WORKMODE │ [Sonnet 4.6] t`. Nach `rm /tmp/t/.claude/mode.state`
bleibt nur `[Sonnet 4.6] t`.

## Wenn der Badge nicht kommt

| Symptom | Ursache |
|---|---|
| gar keine Statusline | Script nicht ausführbar, oder Workspace-Trust nicht bestätigt (`statusline skipped · restart to fix`) |
| Statusline da, Badge fehlt | falsches Projektverzeichnis, oder `.claude/mode.state` leer/weg — `cat .claude/mode.state` im Repo-Root prüfen |
| `\033[1;32m` steht als Text da | `echo` statt `printf '%b\n'` |
| Änderung am Script wirkt nicht | die Statusline aktualisiert erst bei der nächsten Antwort |

## Das Einzige was der Badge nicht kann

Er zeigt dass die Datei da ist — nicht dass Claude die Regeln geladen hat. Neue
Session mit grünem Badge heißt: **einmal `/workmode` tippen.** Die Datei ist schon
da, der Skill kommt in den Kontext, ab da stimmt beides überein.

Ein `SessionStart`-Hook könnte das automatisieren. Das wäre ein bewegliches Teil
mehr, ein Trust-Prompt mehr und ein Fehlerfall mehr — um einen Tastendruck zu
sparen. Genau der Fall den Regel 1 verbietet.
