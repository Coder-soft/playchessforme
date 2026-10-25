/**
 * Engine client — the content-script side of the engine seam.
 * It does not know (or care) where Stockfish actually runs: Chrome routes via
 * offscreen document, Firefox runs in the background event page. One message
 * shape, one promise back.
 */

export interface EngineRequest {
  fen: string;
  /** 0–20 UCI Skill Level. */
  skill: number;
  /** Human-scale think delay in milliseconds (real engine time, not a fake timer). */
  movetimeMs: number;
}

export type EngineResult = { move: string } | { error: string };

const REQUEST_TIMEOUT_MS = 30_000;

export async function requestBestMove(req: EngineRequest): Promise<EngineResult> {
  let resolve!: (r: EngineResult) => void;
  const done = new Promise<EngineResult>((r) => (resolve = r));
  const timer = setTimeout(
    () => resolve({ error: 'engine request timed out' }),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const answer = await browser.runtime.sendMessage({ kind: 'pcfm', type: 'req/engine', req });
    clearTimeout(timer);
    if (!answer || typeof answer !== 'object') {
      resolve({ error: 'bad response from engine host' });
    } else if ('error' in answer) {
      resolve({ error: String(answer.error) });
    } else if (typeof (answer as { move: unknown }).move === 'string') {
      resolve({ move: (answer as { move: string }).move });
    } else {
      resolve({ error: 'engine host returned neither move nor error' });
    }
  } catch (err) {
    clearTimeout(timer);
    resolve({ error: err instanceof Error ? err.message : String(err) });
  }

  return done;
}
