#!/usr/bin/env bash
# Start packages/deckd then the Deck Hub with every-save History.
# JS stay identity ESM (main's live pipeline) — no esbuild/derived serve.
# Usage: ./scripts/run-hub-with-deckd.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DECKD_ROOT="${DECKD_ROOT:-$ROOT/packages/deckd}"
export DECKD_URL="${DECKD_URL:-http://127.0.0.1:8787}"
export DECK_DEMO_HTTP=1
# Volta's Node (22+) can load workspace .ts; Homebrew/system Node 20 cannot.
export PATH="$HOME/.volta/bin:$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

if [[ ! -d "$DECKD_ROOT" ]]; then
  echo "missing deckd at $DECKD_ROOT" >&2
  exit 1
fi

# Free ports from prior runs
for p in 8787 8788; do
  lsof -tiTCP:$p -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
done
sleep 0.5

echo "→ building deckd in $DECKD_ROOT"
# Keep artifacts in-tree (sandbox may redirect CARGO_TARGET_DIR).
(cd "$DECKD_ROOT" && unset CARGO_TARGET_DIR && CARGO_TARGET_DIR="$DECKD_ROOT/target" cargo build --quiet)

echo "→ deckd on $DECKD_URL (every-save History; identity JS on Hub)"
("$DECKD_ROOT/target/debug/deckd") &
DECKD_PID=$!
trap 'kill $DECKD_PID 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
  if curl -sf "$DECKD_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -sf "$DECKD_URL/health" >/dev/null || {
  echo "deckd did not become healthy at $DECKD_URL" >&2
  exit 1
}
echo "  deckd healthy"

echo "→ Hub on http://127.0.0.1:8788 (DECKD_URL=$DECKD_URL)"
cd "$ROOT"
exec env DECKD_URL="$DECKD_URL" DECK_DEMO_HTTP=1 node apps/hub/hub.mjs
