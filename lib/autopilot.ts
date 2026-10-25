/**
 * autopilot module — the only stateful piece of the extension.
 *
 * Loop policy, all in one place: when armed and it's the viewer's move, ask
 * the engine (real think time: the engine computes over the whole delay),
 * play the move, then wait for the opponent. Errors are fail-safe: ANY throw
 * from the game adapter or engine error response disarms with the reason,
 * and the reason is what the pill shows. No silent retry loops.
 *
 * Strength: the engine computes its best move at the caller's chosen Skill
 * Level — the dial lives in the pill, the delay is real engine time. There
 * is no dodge-the-detector logic here by design; see the README for where
 * this project draws that line.
 */

import type { Side } from './chesscom';

export interface GameStateLike {
  fen: string;
  turn: Side;
  me: Side | null;
  over: boolean;
}

export interface AutopilotDeps {
  /** chesscom adapter: watch() fires immediately + on every state change. */
  game: {
    latest?(): GameStateLike | null;
    watch(cb: (s: GameStateLike) => void): void;
    playMove(uci: string): Promise<void>;
  };
  engine: {
    bestMove(req: { fen: string; skill: number; movetimeMs: number }): Promise<
      { move?: string } | { error: string }
    >;
  };
  /** resolved viewer color (pill override, orientation, …) */
  myColor(): Side | null;
  /** skill dial position 0–20 */
  skill(): number;
  log?: (msg: string) => void;
}

export type PilotStatus =
  | { state: 'disarmed' }
  | { state: 'error'; error: string }
  | { state: 'waiting' } // armed, opponent to move
  | { state: 'thinking' } // engine running on our move
  | { state: 'playing' } // move submitted, confirming
  | { state: 'over'; result?: string };

export type ArmResult =
  | { ok: true }
  | { ok: false; error: 'playing' | 'no-color' | 'over' };

export const MOVE_THINK_TIME_MS = [900, 2200] as const;

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

export class Autopilot {
  private deps: AutopilotDeps;
  private armed = false;
  private busy = false;
  private thinkingFen: string | null = null;
  private _status: PilotStatus = { state: 'disarmed' };
  private onStatus?: () => void;

  constructor(deps: AutopilotDeps) {
    this.deps = deps;
    deps.game.watch((s) => this.onState(s));
  }

  /** Pill re-renders on change; pass once, before arm(). */
  onStatusChange(cb: () => void): void {
    this.onStatus = cb;
  }

  status(): PilotStatus {
    return this._status;
  }

  private setStatus(s: PilotStatus): void {
    this._status = s;
    this.onStatus?.();
  }

  arm(): ArmResult {
    if (this._status.state === 'error') {
      this.setStatus({ state: 'disarmed' }); // manual re-arm clears the error
    }
    if (this.armed) return { ok: false, error: 'playing' };

    const color = this.deps.myColor();
    if (!color) return { ok: false, error: 'no-color' };

    const latest = this.deps.game.latest?.() ?? null;
    if (latest?.over) return { ok: false, error: 'over' };

    this.armed = true;
    this.deps.log?.(`armed, playing ${color === 'w' ? 'White' : 'Black'}`);
    this.setStatus({ state: 'waiting' });
    if (latest) this.onState(latest); // react to the position we're already on
    return { ok: true };
  }

  disarm(): void {
    if (!this.armed && this._status.state !== 'error') return;
    this.armed = false;
    this.busy = false;
    this.thinkingFen = null;
    this.deps.log?.('disarmed');
    this.setStatus({ state: 'disarmed' });
  }

  private fail(error: string): void {
    this.armed = false;
    this.busy = false;
    this.thinkingFen = null;
    this.deps.log?.(`FAIL-SAFE disarm: ${error}`);
    this.setStatus({ state: 'error', error });
  }

  private onState(state: GameStateLike): void {
    if (state.over) {
      // One game, minimal: a finished game settles the autopilot down.
      this.armed = false;
      this.busy = false;
      this.thinkingFen = null;
      this.setStatus({ state: 'over' });
      return;
    }

    if (!this.armed || this.busy) return;
    const color = this.deps.myColor() ?? state.me;
    if (!color) return this.fail('lost track of which side you play');
    if (state.turn !== color) {
      this.setStatus({ state: 'waiting' });
      return;
    }

    if (state.turn === color && !this.busy) void this.takeMyMove(state);
  }

  private async takeMyMove(state: GameStateLike): Promise<void> {
    this.busy = true;
    this.thinkingFen = state.fen;
    this.setStatus({ state: 'thinking' });
    try {
      const answer = await this.deps.engine.bestMove({
        fen: state.fen,
        skill: this.deps.skill(),
        movetimeMs: rand(MOVE_THINK_TIME_MS[0], MOVE_THINK_TIME_MS[1]),
      });
      // A change while we thought (opponent move, new game, disarm) → stale.
      if (!this.armed || this.thinkingFen !== state.fen) return;

      if ('error' in answer) throw new Error(`engine: ${answer.error}`);
      if (typeof answer.move !== 'string') throw new Error('engine returned no move');
      const uci = normalizeUci(state.fen, answer.move);
      this.setStatus({ state: 'playing' });
      await this.deps.game.playMove(uci);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      this.busy = false;
      this.thinkingFen = null;
    }
    this.setStatus({ state: 'waiting' });
  }
}

/**
 * Engine UCI vs promotion rules: when a pawn reaches its last rank without a
 * promotion letter (the engine may omit it in some builds), queen it.
 */
export function normalizeUci(fen: string, uci: string): string {
  if (uci.length !== 4) return uci;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const lastRank = turn === 'w' ? '8' : '1';
  if (to[1] !== lastRank) return uci;
  if (pieceAtFenSquare(fen, from)?.toLowerCase() !== 'p') return uci;
  return uci + 'q';
}

export function pieceAtFenSquare(fen: string, square: string): string | null {
  const [placement] = fen.split(' ');
  const file = square.charCodeAt(0) - 97; // 0..7
  const rank = Number.parseInt(square[1], 10); // 1..8

  let f = -1;
  let r = 8;
  for (const ch of placement) {
    if (ch === '/') {
      f = -1;
      r -= 1;
      continue;
    }
    if (/\d/.test(ch)) {
      f += Number.parseInt(ch, 10);
      continue;
    }
    f += 1;
    if (f === file && r === rank) return ch;
  }
  return null;
}
