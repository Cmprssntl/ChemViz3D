#!/usr/bin/env bash
# Copies a packaged web build into the WebView assets.
#
#   ./sync-webapp.sh [source-dir]     default: ../release/android
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="${1:-$PROJECT_DIR/../release/android}"
TARGET="$PROJECT_DIR/app/src/main/assets/webapp"

if [[ ! -f "$SOURCE/index.html" || ! -f "$SOURCE/assets/main.js" ]]; then
  echo "No packaged bundle at $SOURCE (run 'node scripts/package.mjs android' in the main repository)" >&2
  exit 1
fi

if grep -q 'import\.meta' "$SOURCE/assets/main.js"; then
  echo "Bundle still contains import.meta; rebuild with the IIFE config" >&2
  exit 1
fi
if grep -q 'type="module"' "$SOURCE/index.html"; then
  echo "index.html still uses a module script; WebView needs a classic script" >&2
  exit 1
fi

rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -r "$SOURCE/." "$TARGET/"

echo "Synced $(du -sh "$TARGET" | cut -f1) from $SOURCE"
find "$TARGET" -maxdepth 2 -type f | sort
