#!/bin/zsh
# Installs (or updates) playchessforme into the Zen Browser default profile.
#
# Requires Zen to be CLOSED (its profile is locked while running):
#   1. Quit Zen (Cmd+Q or `osascript -e 'quit app "Zen Browser"'`)
#   2. Run this script
#   3. Launch Zen again
#
# Also requires xpinstall.signatures.required=false, which this script adds to
# the profile's user.js on first run (verified: Zen honors it, stock Firefox
# would not — Zen is a fork that keeps the pref user-settable).
set -euo pipefail

PROFILE="${HOME}/Library/Application Support/zen/Profiles/jendxqmb.Default (alpha)"
EXT_DIR="${PROFILE}/extensions"
ADDON_ID="playchessforme@coder-soft.github.io"
XPI=".output/playchessforme-0.1.0-firefox.zip"

if pgrep -x zen >/dev/null 2>&1 || pgrep -f "MacOS/zen" >/dev/null 2>&1; then
  echo "Zen is running. Quit it first: osascript -e 'quit app \"Zen Browser\"'" >&2
  exit 1
fi
if [[ ! -f "$XPI" ]]; then
  echo "xpi missing — build first: npm run build:firefox" >&2
  exit 1
fi

mkdir -p "$EXT_DIR"
cp ".output/playchessforme-0.1.0-firefox.zip" "$PROFILE/extensions/${ADDON_ID}.xpi.new"

# atomically replace so Firefox's change-detection (mtime) picks it up
mv "$PROFILE/extensions/${ADDON_ID}.xpi.new" "$PROFILE/extensions/${ADDON_ID}.xpi"

# first-run: allow unsigned installs
if ! grep -q "xpinstall.signatures.required" "$PROFILE/user.js" 2>/dev/null; then
  echo 'user_pref("xpinstall.signatures.required", false);' >> "$PROFILE/user.js"
  echo "added xpinstall.signatures.required=false to profile user.js"
fi

echo "installed. Launch Zen; the autopilot pill appears on chess.com game pages."
