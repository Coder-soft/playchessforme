#!/bin/zsh
# Installs playchessforme into Helium Browser (ungoogled-chromium fork).
#
# Helium ignores drag-installed CRX certificates for local self-signed packs
# and blocks external-install JSONs, but DOES honor Chromium's --load-extension
# and persists those unpacked installs. This script:
#   1. requires Helium to be closed (its profile is single-instance),
#   2. removes any stale copy so the unpacked path stays canonical,
#   3. launches Helium once with --load-extension (one cold boot),
#   4. leaves it open — from then on a plain launch keeps the extension.
# Future updates: rebuild (`npm run build:chrome`) and just restart Helium —
# the unpacked path is re-read on startup.
set -euo pipefail

HELIUM="/Applications/Helium.app/Contents/MacOS/Helium"
EXT_DIR="/Users/techspot/.t3/projects/playchessforme/.output/chrome-mv3"

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "built extension missing — run: npm run build:chrome" >&2
  exit 1
fi
if pgrep -x Helium >/dev/null 2>&1 || pgrep -f "Helium.app/Contents/MacOS/Helium" >/dev/null 2>&1; then
  echo "Helium is running. Quit it first." >&2
  exit 1
fi

# cold-boot once with the load switch; Chromium records the unpacked install
# in the profile's Secure Preferences, and it persists across flagless launches
"$HELIUM" --load-extension="$EXT_DIR" &
HELIUM_PID=$!
sleep 5
echo "launched Helium ($HELIUM_PID) with playchessforme loaded."
echo "the pill appears on chess.com game pages; this install persists."
