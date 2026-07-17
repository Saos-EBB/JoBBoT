#!/usr/bin/env bash
# Mode-Badge für die Claude Code Statusline.
# Zeigt den Inhalt von .claude/mode.state (Name des aktiven Modus) grün an.
# Generisch für jeden Mode-Skill der denselben State-File nutzt — ein neuer Modus
# braucht kein Update hier, nur einen anderen Wert in derselben Datei.
# Kein jq nötig — die zwei Felder holt grep aus dem JSON auf stdin.

input=$(cat)

field() { printf '%s' "$input" | grep -o "\"$1\": *\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

project_dir=$(field project_dir)
[ -z "$project_dir" ] && project_dir=$(field cwd)
model=$(field display_name)

mode=$(cat "$project_dir/.claude/mode.state" 2>/dev/null)

badge=""
[ -n "$mode" ] && badge="\033[1;32m● $(printf '%s' "$mode" | tr '[:lower:]' '[:upper:]')\033[0m │ "

printf '%b\n' "${badge}[${model}] ${project_dir##*/}"
