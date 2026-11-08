#!/usr/bin/env bash
# Runs the speech bridge in the foreground (start it as a background task; stop with stop.sh or Ctrl-C).
set -euo pipefail
source "$(dirname "$0")/env.sh"
if curl -fs --max-time 2 http://127.0.0.1:18761/health >/dev/null; then echo "Bridge already running on 18761; reusing it."; exit 0; fi
exec "$BUN" "$RUNTIME_DIR/bridge.mjs"
