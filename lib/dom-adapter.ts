/**
 * DOM adapter — the chesscom module's read-only fallback adapter.
 *
 * Polls the board's piece classes (~700ms, cheap diff on class signature),
 * rebuilds a FEN with lib/dom-fen and reports state like the bridge does.
 * playMove always rejects: without the page-scope bridge there is no honest
 * way to submit a move, and submitting a guessed one is the failure the
 * fail-safe exists to prevent.
 */
import type { GameAdapter, GameState, Side } from './chesscom';
import { parseBoardTofen } from './dom-fen';

const POLL_MS = 700;

export function createDomAdapter(): GameAdapter {
  const watchers = new Set<(s: GameState) => void>();
  let latestState: GameState | null = null;
  let signature = '';

  function mine(turn: string, orientation: Side): Side | null {
    // The DOM fallback can't tell "viewer" from "the person whose turn it is":
    // conservative null makes the pill ask, which is honest and correct.
    void turn;
    void orientation;
    return null;
  }

  function poll(): void {
    const result = parseBoardTofen(document.documentElement);
    if (!result) return; // unknown markup → skip, never fabricate

    const sig = result.fen.split(' ')[0];
    if (sig === signature) return;
    signature = sig;

    const over = !!document.querySelector('.game-over-message-component');
    latestState = {
      fen: result.fen,
      turn: result.fen.split(' ')[1] === 'b' ? 'b' : 'w',
      me: mine(result.fen, result.orientation),
      over,
    };
    for (const cb of watchers) cb(latestState);
  }

  void setInterval(poll, POLL_MS);
  poll();

  return {
    name: 'dom',
    watch(cb) {
      watchers.add(cb);
      if (latestState) cb(latestState);
    },
    latest: () => latestState,
    playMove() {
      // This reject is what disarms the autopilot when the bridge is gone.
      return Promise.reject(
        new Error('page bridge unavailable — DOM fallback is watch-only'),
      );
    },
  };
}
