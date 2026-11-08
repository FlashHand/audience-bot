#!/usr/bin/env bash
# Read-only health check of the live-reply runtime.
set -uo pipefail
source "$(dirname "$0")/env.sh"
ok() { printf '  ok    %s\n' "$*"; }
no() { printf '  MISS  %s\n' "$*"; }
echo "runtime $RUNTIME_DIR  dozin $DOZIN_EDITION ($DOZIN_BUNDLE_ID)"
[ -x "$RUNTIME_DIR/whisper.cpp/build/bin/whisper-server" ] && ok "whisper-server built" || no "whisper-server (run install.sh)"
ls "$RUNTIME_DIR"/models/ggml-*.bin >/dev/null 2>&1 && ok "model $(basename "$(ls "$RUNTIME_DIR"/models/ggml-*.bin | head -1)")" || no "speech model (run install.sh)"
codesign --verify --strict "$CAPTION_APP" 2>/dev/null && ok "capture app signed" || no "capture app (run install.sh)"
if [ -f "$DOZIN_HOME/skills/douyin-live-reply/SKILL.md" ]; then ok "skill douyin-live-reply"; else no "skill douyin-live-reply (run install.sh)"; fi
h="$(curl -fs --max-time 2 http://127.0.0.1:18761/health || true)"
[ -n "$h" ] && ok "bridge $h" || no "bridge not running (start-bridge.sh)"
n="$(pgrep -x dozin-caption | wc -l | tr -d ' ')"
case "$n" in 0) no "capture app not running (start-caption.sh)";; 1) ok "capture app running";; *) no "$n capture apps running: run stop.sh, then start one";; esac
if [ -f "$STATE_PATH" ]; then
  "$BUN" -e 'const s=JSON.parse(await Bun.file(process.argv[1]).text());const last=s.messages?.at(-1);console.log("  state",s.status,"frames",s.audioFrames,"messages",s.messages?.length??0,last?"last "+Math.round((Date.now()-last.at)/1000)+"s ago: "+last.text:"")' "$STATE_PATH"
else no "no capture state yet"; fi
