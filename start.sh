#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT=${PORT:-0}

if [ ! -f "$SCRIPT_DIR/dist/index.html" ]; then
  printf '%s\n' "[ERROR] dist/index.html not found. Run npm run build first."
  exit 1
fi

if [ -x "$SCRIPT_DIR/ChemViz3D" ]; then
  exec "$SCRIPT_DIR/ChemViz3D"
fi

if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  printf '%s\n' "[ERROR] Python 3 is required for the desktop client."
  exit 1
fi

cd "$SCRIPT_DIR"

if ! "$PYTHON" -c 'import PySide6' >/dev/null 2>&1; then
  if command -v uv >/dev/null 2>&1; then
    printf '%s\n' "PySide6 is not installed; starting it through uv..."
    exec uv run --with 'PySide6>=6.7,<7' python -m desktop --root "$SCRIPT_DIR" --port "$PORT"
  fi
  printf '%s\n' "[ERROR] PySide6 is required. Install desktop/requirements.txt, then run start.sh again."
  exit 1
fi

exec "$PYTHON" -m desktop --root "$SCRIPT_DIR" --port "$PORT"
