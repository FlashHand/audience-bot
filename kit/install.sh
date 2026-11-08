#!/usr/bin/env bash
# One-shot setup of the Douyin live-reply runtime on a Mac.
# Builds whisper.cpp, downloads the speech model, builds and signs the capture app, installs the skill into Dozin.
# Options (env): DOZIN_EDITION=production|preview  MODEL=large-v3-turbo-q5_0|small-q5_1  SIGN_IDENTITY="Developer ID Application: …"
#                RUNTIME_DIR=…  WHISPER_SRC=<git url or local clone>  MODEL_SOURCE=<local .bin to copy>  SKIP_SMOKE=1
set -euo pipefail
source "$(dirname "$0")/env.sh"
say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

say "Checks"
major="$(sw_vers -productVersion | cut -d. -f1)"
[ "$major" -ge 13 ] || fail "macOS 13 or newer is required (ScreenCaptureKit audio)"
for c in git cmake swiftc curl codesign shasum; do command -v "$c" >/dev/null || fail "missing command: $c (install Xcode Command Line Tools, and cmake via Homebrew)"; done
[ -d "$DOZIN_APP" ] || fail "Dozin app not found: $DOZIN_APP (set DOZIN_EDITION)"
[ -n "$BUN" ] && [ -x "$BUN" ] || fail "Bun not found (it ships inside Dozin)"
echo "Dozin: $DOZIN_EDITION ($DOZIN_BUNDLE_ID)   runtime: $RUNTIME_DIR   model: $MODEL"
# Models (~550 MB) must never land in Git: refuse a runtime dir inside a repo unless Git ignores it.
probe="$RUNTIME_DIR"; while [ ! -d "$probe" ]; do probe="$(dirname "$probe")"; done
if top="$(git -C "$probe" rev-parse --show-toplevel 2>/dev/null)"; then
  git -C "$top" check-ignore -q --no-index "$RUNTIME_DIR/models/ggml-$MODEL.bin" || fail "RUNTIME_DIR $RUNTIME_DIR is inside Git repo $top and not ignored; the model would enter Git. Use a folder outside any repo (default ~/.dozin-live-caption)."
fi
mkdir -p "$RUNTIME_DIR/runtime" "$RUNTIME_DIR/models" "$RUNTIME_DIR/sessions" "$RUNTIME_DIR/empty-public"

say "whisper.cpp $WHISPER_REF"
W="$RUNTIME_DIR/whisper.cpp"
if [ ! -d "$W/.git" ]; then git clone --depth 1 --branch "$WHISPER_REF" "${WHISPER_SRC:-https://github.com/ggml-org/whisper.cpp.git}" "$W"; fi
if [ ! -x "$W/build/bin/whisper-server" ]; then
  cmake -S "$W" -B "$W/build" -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF
  cmake --build "$W/build" --config Release -j --target whisper-server whisper-cli
fi
[ -x "$W/build/bin/whisper-server" ] || fail "whisper-server was not built"

say "Speech model ggml-$MODEL"
case "$MODEL" in
  large-v3-turbo-q5_0) SHA=394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2 ;;
  small-q5_1) SHA=ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb ;;
  *) fail "MODEL must be large-v3-turbo-q5_0 or small-q5_1" ;;
esac
M="$RUNTIME_DIR/models/ggml-$MODEL.bin"
if [ ! -f "$M" ] || [ "$(shasum -a 256 "$M" | cut -d' ' -f1)" != "$SHA" ]; then
  if [ -n "${MODEL_SOURCE:-}" ]; then cp "$MODEL_SOURCE" "$M.part"; else curl -fL --retry 3 -o "$M.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"; fi
  [ "$(shasum -a 256 "$M.part" | cut -d' ' -f1)" = "$SHA" ] || { rm -f "$M.part"; fail "model checksum mismatch"; }
  mv "$M.part" "$M"
fi
echo "ok: $M"

say "Speech bridge"
cp "$KIT_DIR/runtime/bridge.mjs" "$RUNTIME_DIR/bridge.mjs"
echo "ok: $RUNTIME_DIR/bridge.mjs"

say "Capture app"
BUILD="$RUNTIME_DIR/build"; mkdir -p "$BUILD" "$CAPTION_APP/Contents/MacOS"
esc() { printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'; }
sed -e "s|__STATE_PATH__|$(esc "$STATE_PATH")|" -e "s|__TARGET_BUNDLE_ID__|$DOZIN_BUNDLE_ID|" "$KIT_DIR/runtime/continuous.swift" > "$BUILD/continuous.swift"
cp "$KIT_DIR/runtime/Info.plist" "$CAPTION_APP/Contents/Info.plist"
swiftc -O "$BUILD/continuous.swift" -o "$CAPTION_APP/Contents/MacOS/dozin-caption"
IDENTITY="${SIGN_IDENTITY:-$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/{print $2; exit}')}"
if [ -z "$IDENTITY" ]; then
  IDENTITY="-"
  echo "WARNING: no Developer ID certificate; ad-hoc signing. macOS will ask for Screen Recording again after every rebuild."
fi
codesign --force --sign "$IDENTITY" --options runtime --timestamp=none "$CAPTION_APP"
codesign --verify --strict "$CAPTION_APP"
echo "ok: $CAPTION_APP (signed: $IDENTITY)"

say "Skill douyin-live-reply"
SKILL_SRC="$REPO_DIR/skill/douyin-live-reply"
SKILL_DST="$DOZIN_HOME/skills/douyin-live-reply"
[ -f "$SKILL_SRC/SKILL.md" ] || fail "skill not found at $SKILL_SRC"
if [ -d "$SKILL_DST" ] && ! diff -qr "$SKILL_SRC" "$SKILL_DST" >/dev/null 2>&1; then
  echo "kept: $SKILL_DST differs from this repo and was left as it is (remove it and rerun to reinstall)"
else
  mkdir -p "$SKILL_DST" && cp -R "$SKILL_SRC/." "$SKILL_DST/"
  echo "ok: $SKILL_DST (Dozin picks it up in the next chat message)"
fi

if [ -z "${SKIP_SMOKE:-}" ]; then
  say "Smoke test: transcribe whisper.cpp sample"
  "$W/build/bin/whisper-cli" -m "$M" -f "$W/samples/jfk.wav" -l en -nt -np 2>/dev/null | grep -v '^[[:space:]]*$' | head -3
fi

say "Done"
echo "Next: run doctor.sh, start the bridge and the capture app (see README.md), then grant Screen Recording to 'Dozin Live Caption'."
