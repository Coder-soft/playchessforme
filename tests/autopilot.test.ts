/**
 * Autopilot behavior, driven end-to-end through its interface only (fake game
 * adapter + fake engine on the two seams). This is the test surface the
 * design promised: no DOM, no worker, no chess.com.
 */
import { Autopilot, normalizeUci, pieceAtFenSquare, type GameStateLike } from '@/lib/autopilot';
import type { Side } from '@/lib/chesscom';

interface CannedAnswer {
  move?: string;
  error?: string;
}
type Answer = { move: string } | { error: string };

interface FakeGame {
  setState(s: GameStateLike): void;
  played: string[];
  failNextPlay(error: string): void;
}

interface Deps {
  pilot: Autopilot;
  game: FakeGame;
  engineCalls: Array<{ fen: string; skill: number }>;
}

function mainState(fen: string, turn: Side = 'w'): GameStateLike {
  return { fen, turn, me: 'w', over: false };
}

function makeDeps(color: Side | null = 'w', canned: CannedAnswer[] = []): Deps {
  const engineCalls: Array<{ fen: string; skill: number }> = [];
  const answers: Answer[] = canned.map((a) =>
    a.error ? { error: a.error } : { move: a.move ?? '' },
  );
  const played: string[] = [];
  let current: GameStateLike | null = null;
  let rejectPlay: string | null = null;

  const game: FakeGame = {
    played,
    setState(s) {
      current = s;
      for (const cb of watchers) cb(s);
    },
    failNextPlay(error) {
      rejectPlay = error;
    },
  };
  const watchers: Array<(s: GameStateLike) => void> = [];

  const pilot = new Autopilot({
    game: {
      latest: () => current,
      watch(cb) {
        watchers.push(cb);
        if (current) cb(current);
      },
      playMove(uci) {
        if (rejectPlay) {
          const e = rejectPlay;
          rejectPlay = null;
          return Promise.reject(new Error(e));
        }
        played.push(uci);
        return Promise.resolve();
      },
    },
    engine: {
      bestMove(req) {
        engineCalls.push({ fen: req.fen, skill: req.skill });
        const next = answers.shift() ?? { error: 'harness ran out of canned answers' };
        // the real engine takes time; deferring keeps the loop honest
        return new Promise<Answer>((r) => setTimeout(() => r(next), 20));
      },
    },
    myColor: () => color,
    skill: () => 8,
    log: () => {},
  });

  return { pilot, game, engineCalls };
}

const flush = () => new Promise((r) => setTimeout(r, 40));

test('plays the engine move when it is our turn from the start position', async () => {
  const d = makeDeps('w', [{ move: 'e2e4' }]);
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'));
  d.pilot.arm();
  await flush();
  expect(d.game.played).toEqual(['e2e4']);
  // the engine was asked about the exact position on the board
  expect(d.engineCalls[0].fen).toContain('RNBQKBNR w');
});

test('arm() on a position that is already ours triggers immediately', async () => {
  const d = makeDeps('w', [{ move: 'g1f3' }]);
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'));
  d.pilot.arm();
  await flush();
  expect(d.game.played).toEqual(['g1f3']);
});

test('armed and opponent turn → waiting, no engine call', async () => {
  const d = makeDeps('w', [{ move: 'e2e4' }]);
  d.pilot.arm();
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w', 'b'));
  await flush();
  expect(d.game.played).toEqual([]);
  expect(d.engineCalls).toHaveLength(0);
  expect(d.pilot.status()).toEqual({ state: 'waiting' });
});

test('never armed → nothing moves', async () => {
  const d = makeDeps('w', [{ move: 'e2e4' }]);
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'));
  await flush();
  expect(d.game.played).toEqual([]);
  expect(d.pilot.status()).toEqual({ state: 'disarmed' });
});

test('arm without a known color bounces with no-color and moves nothing', async () => {
  const d = makeDeps(null, [{ move: 'e2e4' }]);
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'));
  const result = d.pilot.arm();
  expect(result).toEqual({ ok: false, error: 'no-color' });
  await flush();
  expect(d.game.played).toEqual([]);
});

test('engine error → fail-safe disarm with the engine error visible', async () => {
  const d = makeDeps('w', [{ error: 'stockfish hit a wall' }]);
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'));
  d.pilot.arm();
  await flush();
  expect(d.game.played).toEqual([]);
  expect(d.pilot.status()).toEqual({ state: 'error', error: 'engine: stockfish hit a wall' });
  // the fail-safe matters: a second, fine move must NOT sneak through
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w', 'b'));
  await flush();
  expect(d.game.played).toEqual([]);
});

test('playMove rejection (chess.com refuses) → fail-safe disarm', async () => {
  const d = makeDeps('w', [{ move: 'e2e4' }]);
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'));
  d.pilot.arm();
  d.game.failNextPlay('chess.com game controller not available');
  await flush();
  expect(d.game.played).toEqual([]);
  const s = d.pilot.status();
  if (s.state !== 'error') throw new Error(`expected error state, got ${s.state}`);
  expect(s.error).toContain('chess.com game controller not available');
});

test('disarm during thinking prevents the move from even submitting', async () => {
  const d = makeDeps('w', [{ move: 'e2e4' }]);
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'));
  d.pilot.arm();
  d.pilot.disarm(); // mid-think
  await flush();
  expect(d.game.played).toEqual([]);
  expect(d.pilot.status()).toEqual({ state: 'disarmed' });
});

test('a finished game settles the autopilot into "over"', async () => {
  const d = makeDeps('w', [{ move: 'e2e4' }]);
  d.pilot.arm();
  d.game.setState({ fen: 'x', turn: 'w', me: 'w', over: true });
  expect(d.pilot.status()).toEqual({ state: 'over' });
  // and it does not keep playing after the game ended
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'));
  await flush();
  expect(d.game.played).toEqual([]);
});

test('normalizeUci queens the pawn push the engine left bare', () => {
  const fen = 'rnbqkbnr/pp2pppp/8/8/8/8/pppppppp/RNBQKBNR w KQkq - 0 1';
  expect(normalizeUci(fen, 'a7a8')).toBe('a7a8q'); // white pawn a7→a8
  const blackFen = 'rnbqkbnr/pppppppp/8/8/8/8/Pp4PP/RNBQKBNR b KQkq - 0 1';
  expect(normalizeUci(blackFen, 'b2b1')).toBe('b2b1q'); // black push b2→b1
});

test('normalizeUci leaves non-promotions and explicit promotions alone', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  expect(normalizeUci(fen, 'e2e4')).toBe('e2e4');
  expect(normalizeUci(fen, 'a7a8q')).toBe('a7a8q'); // already explicit
});

test('pieceAtFenSquare reads FEN squares', () => {
  const fen = 'rnbqkbnr/pppppppp/8/1B6/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  expect(pieceAtFenSquare(fen, 'b5')).toBe('B');
  expect(pieceAtFenSquare(fen, 'e2')).toBe('P');
  expect(pieceAtFenSquare(fen, 'a8')).toBe('r');
  expect(pieceAtFenSquare(fen, 'h4')).toBeNull();
});

test('arm while already armed refuses without side effects', async () => {
  const d = makeDeps('w', [{ move: 'e2e4' }]);
  d.game.setState(mainState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w', 'b'));
  expect(d.pilot.arm()).toEqual({ ok: true });
  expect(d.pilot.arm()).toEqual({ ok: false, error: 'playing' });
});
