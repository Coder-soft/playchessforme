<img src="assets/icon.svg" width="64" height="64" alt="">

# playchessforme

Browser extension for **Chrome** and **Firefox** that plays your chess.com
live games while you're away. Toggle it on, make your coffee, come back to a
played game.

> ⚠️ **This violates chess.com's fair-play policy.** Chess.com closes accounts
> (~3,500/day) when game analysis flags engine-like play, and their closure
> reason is literally `closed:fair_play_violations`. Running it on your main
> account *will* eventually get it closed. Use a throwaway, or don't.

## What it does

- Watch a live game; a pill in the corner shows what it's doing. **Never
  silent**: every failure prints its reason in the pill and stops the loop.
- Arm it and it plays your moves: state → Stockfish → the same page-scope
  API chess.com's own UI uses to submit a drag.
- Strength dial (UCI Skill Level 0–20) and a real think-time delay per move
  (0.9–2.2 s; the engine genuinely computes over that time).
- It plays **one game, minimal**: no premoves, no tournaments, no automatch.
- **Fail-safe**: any broken parser, missing page-scope API, or engine error
  disarms the autopilot and tells you why. A silently wrong move is the
  failure mode this design refuses.

Two access adapters behind one interface:

| adapter            | reads | plays | notes                                            |
| ------------------ | ----- | ----- | ------------------------------------------------ |
| page-scope bridge  | ✅    | ✅    | `game.getFEN()` / `game.move()` from page scope  |
| DOM scrape fallback| ✅    | ❌    | watch-only; visible fallback when the page-scope API is gone |

## Build from source

```bash
npm install
npm run build:chrome     # dist/chrome-mv3
npm run build:firefox    # dist/firefox-mv3
npm run zip              # store zips for both
```

## Install (Chrome + Firefox)

- **Chrome**: chrome://extensions → Developer mode → Load unpacked → `dist/chrome-mv3`
- **Firefox**: about:debugging#/runtime/this-firefox → Load Temporary Add-on →
  pick `manifest.json` inside `dist/firefox-mv3` *(resets on restart)*
- **Firefox, permanent (signed builds only)**: install
  `.output/playchessforme-0.1.0-firefox.zip` via about:addons.

## Install into Zen Browser (used by this project's author)

Zen honors `xpinstall.signatures.required=false`, so the unsigned Firefox build
installs permanently:

```bash
npm run build:firefox
sh scripts/install-zen.sh   # quit Zen first; the script exits loudly if it runs
open -a "Zen Browser"
```

The script swaps the xpi at the same internal-id path, so Firefox re-syncs it
on launch (update flow = rebuild + rerun script).

## Design

Four modules, three seams (see `lib/`):

- **engine** — Stockfish 19 lite (single-threaded WASM) behind
  `bestMove(fen, {skill, movetimeMs}) → uci`. Chrome: MV3 offscreen document
  (service workers can't spawn workers). Firefox: just runs in the background
  event page.
- **chesscom** — board watching + move play, with the two adapters above. The
  DOM adapter fails *visibly* (parses go `null`), never invents boards.
- **autopilot** — the only stateful module: watch → engine → play, fail-safe
  disarm on any error, stale-think guard, game-over settle.
- **pill** — the UI. Off / armed-waiting / thinking / paused(: reason) / over.

Tests cover the autopilot state machine and the DOM parser against synthesized
chess.com-style markup, all through module interfaces — no browser needed.

### The line this project draws

The extension automates play and takes the ban risk with eyes open. It
deliberately does **not** contain anti-detection engineering — no fabricated
think-time profiles, no intentionally suboptimal "plausible" moves picked to
defeat chess.com's statistical detector. Strength and think time are real
settings, not disguises.

## Legal

MIT. Not affiliated with chess.com; chess.com's ToS forbid this tool's use on
their site.
