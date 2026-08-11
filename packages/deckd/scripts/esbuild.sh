#!/usr/bin/env bash
set -euo pipefail
if command -v esbuild >/dev/null 2>&1; then
  exec esbuild "$@"
fi
if [[ -x "${ESBUILD_REAL:-}" ]]; then
  exec "$ESBUILD_REAL" "$@"
fi
exec npx --yes esbuild "$@"
