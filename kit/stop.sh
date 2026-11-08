#!/usr/bin/env bash
# Stops the capture app and the speech bridge started by this kit. Leaves models and builds in place.
set -uo pipefail
source "$(dirname "$0")/env.sh"
pids="$(pgrep -x dozin-caption || true)"
[ -n "$pids" ] && kill -TERM $pids && echo "capture app stopped: $pids"
pids="$(pgrep -f "$RUNTIME_DIR/bridge.mjs" || true)"
[ -n "$pids" ] && kill -TERM $pids && echo "bridge stopped: $pids"
sleep 1
left="$(pgrep -fl 'dozin-caption|whisper-server|bridge.mjs' || true)"
[ -z "$left" ] && echo "nothing left running" || { echo "still running:"; echo "$left"; }
