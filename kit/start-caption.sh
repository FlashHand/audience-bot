#!/usr/bin/env bash
# Runs the capture app until it quits (start it as a background task). Refuses a second instance:
# two capture apps share one bridge and make transcription fail (seen 2026-11-06).
set -euo pipefail
source "$(dirname "$0")/env.sh"
if pgrep -f "$CAPTION_APP/Contents/MacOS/dozin-caption" >/dev/null || pgrep -x dozin-caption >/dev/null; then
  echo "Capture app already running (pid $(pgrep -x dozin-caption | tr '\n' ' ')). Run stop.sh first if you want a fresh one."; exit 1
fi
curl -fs --max-time 2 http://127.0.0.1:18761/health >/dev/null || { echo "Bridge is not running; start start-bridge.sh first."; exit 1; }
exec open -n -W --stdout "$RUNTIME_DIR/runtime/caption.stdout" --stderr "$RUNTIME_DIR/runtime/caption.stderr" "$CAPTION_APP"
