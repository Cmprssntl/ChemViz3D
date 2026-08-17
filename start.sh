#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT=${PORT:-8080}

if [ ! -f "$SCRIPT_DIR/dist/index.html" ]; then
  printf '%s\n' "[ERROR] dist/index.html not found. Run npm run build first."
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  printf '%s\n' "[ERROR] Python 3 is required to serve the built application."
  exit 1
fi

printf '%s\n' "ChemViz3D is running at http://127.0.0.1:$PORT"
printf '%s\n' "Press Ctrl+C to stop the server."
exec "$PYTHON" -m http.server "$PORT" --bind 127.0.0.1 --directory "$SCRIPT_DIR/dist"
