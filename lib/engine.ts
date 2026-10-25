/**
 * Engine module — Stockfish behind a tiny promise interface.
 *
 * The UCI engine is a WASM worker; this file owns the protocol noise
 * (uciok/readyok handshakes, skill options, bestmove parsing) so every
 * caller sees exactly one shape: `bestMove(fen, …) -> uci`.
 *
 * Both browser adapters (Chrome offscreen document, Firefox background
 * event page) build their worker with this factory; where the worker is
 * *kept alive* differs, but the interface does not.
 */

export interface EngineOptions {
  /** 0–20, UCI "Skill Level". The autopilot's strength dial feeds this. */
  skill: number;
}

const INIT_TIMEOUT_MS = 15_000;
/** Generous ceiling over the movetime we asked for. */
const BOOKKEEP_SLACK_MS = 10_000;

export interface UciEngine {
  /** Handshake with the engine. Resolves once it accepts input. */
  init(): Promise<void>;
  /** One UCI search. Resolves with a move like `e2e4` (or `e7e8q`). */
  bestMove(fen: string, opts: EngineOptions & { movetimeMs: number }): Promise<string>;
  dispose(): void;
}

export type WorkerLike = {
  postMessage(cmd: string): void;
  onmessage: ((ev: { data: string }) => void) | null;
};

export function createUciEngine(worker: WorkerLike): UciEngine {
  const listeners = new Set<(line: string) => void>();
  worker.onmessage = (ev) => {
    for (const fn of listeners) fn(String(ev.data));
  };

  const send = (cmd: string) => worker.postMessage(cmd);

  function waitFor(match: (line: string) => boolean, timeoutErr: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(timeoutErr)), INIT_TIMEOUT_MS);
      const fn = (line: string) => {
        if (match(line)) {
          clearTimeout(timer);
          listeners.delete(fn);
          resolve(line);
        }
      };
      listeners.add(fn);
    });
  }

  /** Race one `bestmove` line while `go` is being throttled by other listeners. */
  function waitBestMove(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('engine did not answer in time')), timeoutMs);
      const fn = (line: string) => {
        if (line.startsWith('bestmove')) {
          clearTimeout(timer);
          listeners.delete(fn);
          const mv = line.split(/\s+/)[1] ?? '';
          if (!mv || mv === '(none)') reject(new Error('engine returned no move'));
          else resolve(mv);
        }
      };
      listeners.add(fn);
    });
  }

  return {
    async init() {
      const uciok = waitFor((l) => l === 'uciok', 'engine never said uciok');
      send('uci');
      await uciok;
      const ready = waitFor((l) => l === 'readyok', 'engine never said readyok');
      send('isready');
      await ready;
    },

    async bestMove(fen, opts) {
      const pending = waitBestMove(opts.movetimeMs + BOOKKEEP_SLACK_MS);
      send(`setoption name Skill Level value ${opts.skill}`);
      send('position fen ' + fen);
      send(`go movetime ${opts.movetimeMs}`);
      return pending;
    },

    dispose() {
      listeners.clear();
      send('quit');
    },
  };
}

export function parseEngineOutput(line: string): string | null {
  if (!line.startsWith('bestmove')) return null;
  const mv = line.split(/\s+/)[1] ?? '';
  return mv && mv !== '(none)' ? mv : null;
}
