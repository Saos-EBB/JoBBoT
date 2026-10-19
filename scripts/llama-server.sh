#!/usr/bin/env bash
# Startet llama-server im Router-Modus mit den Presets aus config/llama-models.ini.
# Ein Modell zur Zeit im RAM (--models-max 1); nach 5 min Leerlauf schläft die
# Modell-Instanz und gibt den Speicher frei.
#
#   LLAMA_BIN         Pfad zu llama-server (Default ~/.local/opt/llama.cpp/current/llama-server)
#   LLAMA_MODELS_DIR  GGUF-Ordner (Default ~/.local/share/llama-models)
#   LLAMACPP_PORT     Port (Default 8089, passend zu LLAMACPP_HOST in config.ts)
set -euo pipefail
cd "$(dirname "$0")/.."

LLAMA_BIN="${LLAMA_BIN:-$HOME/.local/opt/llama.cpp/current/llama-server}"
MODELS_DIR="${LLAMA_MODELS_DIR:-$HOME/.local/share/llama-models}"
PORT="${LLAMACPP_PORT:-8089}"
PRESET="${XDG_RUNTIME_DIR:-/tmp}/jobbot-llama-models.ini"

sed "s#{{MODELS_DIR}}#${MODELS_DIR}#g" config/llama-models.ini > "$PRESET"

exec "$LLAMA_BIN" \
  --models-preset "$PRESET" \
  --models-max 1 \
  --sleep-idle-seconds 300 \
  --host 127.0.0.1 --port "$PORT"
