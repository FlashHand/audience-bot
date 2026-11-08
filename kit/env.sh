# Shared settings for the Douyin live-reply kit. Sourced by the other scripts; every value can be overridden by env.
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$KIT_DIR/.." && pwd)"
# Outside any Git repository: the speech model (~550 MB) must never be committed.
RUNTIME_DIR="${RUNTIME_DIR:-$HOME/.dozin-live-caption}"
# Which Dozin build plays the live room: production or preview.
if [ -z "${DOZIN_EDITION:-}" ]; then
  if [ -d "/Applications/Dozin.app" ]; then DOZIN_EDITION=production; else DOZIN_EDITION=preview; fi
fi
case "$DOZIN_EDITION" in
  production) DOZIN_APP="/Applications/Dozin.app"; DOZIN_BUNDLE_ID="ai.dozin.desktop"; DOZIN_HOME="$HOME/.dozin" ;;
  preview) DOZIN_APP="/Applications/Dozin Preview.app"; DOZIN_BUNDLE_ID="ai.dozin.desktop.preview"; DOZIN_HOME="$HOME/.dozin_preview" ;;
  *) echo "DOZIN_EDITION must be production or preview" >&2; exit 2 ;;
esac
BUN="${PI_APP_BUN_PATH:-$DOZIN_APP/Contents/Resources/maestro-tools/bun}"
[ -x "$BUN" ] || BUN="$(command -v bun || true)"
MODEL="${MODEL:-large-v3-turbo-q5_0}"
WHISPER_REF="${WHISPER_REF:-v1.9.5}"
CAPTION_APP="$RUNTIME_DIR/Dozin Live Caption.app"
STATE_PATH="$RUNTIME_DIR/runtime/continuous-state.json"
