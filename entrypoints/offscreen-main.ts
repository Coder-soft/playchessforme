/**
 * Chrome offscreen document — the actual engine adapter.
 *
 * Exists only in Chrome MV3 (service workers can't spawn workers). Sets up one
 * Stockfish worker and answers engine requests posted by the background. It
 * deliberately ignores 'req/engine' broadcasts from the content script: only
 * the background's 'req/engine-true' handoff is legitimate, so these two can't
 * double-answer.
 */
import type { EngineOptions } from '@/lib/engine';
import { createUciEngine, type UciEngine, type WorkerLike } from '@/lib/engine';
import type { EngineRequest } from '@/lib/engine-client';

let engineCache: Promise<UciEngine> | undefined;

function getEngine(): Promise<UciEngine> {
  if (engineCache === undefined) {
    const worker = new Worker(assetUrl('engine/stockfish-19-lite-single.js'));
    const e = createUciEngine(worker as unknown as WorkerLike);
    engineCache = e.init().then(() => e);
  }
  return engineCache;
}

/** The engine files are copied by scripts/copy-engine.mjs, so the generated
 * PublicPath union doesn't know them — bypass the static type deliberately. */
const assetUrl = (path: string): string =>
  (browser.runtime.getURL as unknown as (p: string) => string)(path);

export default defineUnlistedScript(() => {
  browser.runtime.onMessage.addListener(
    (msg: { kind?: string; type?: string; req?: EngineRequest }, _sender, sendResponse) => {
      if (msg?.kind !== 'pcfm' || msg.type !== 'req/engine-true' || !msg.req) return false;
      const req: EngineRequest = msg.req;

      void (async () => {
        try {
          const eng = await getEngine();
          const move = await eng.bestMove(req.fen, {
            skill: req.skill,
            movetimeMs: req.movetimeMs,
          } satisfies EngineOptions & { movetimeMs: number });
          sendResponse({ move });
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        }
      })();

      return true; // async sendResponse
    },
  );
});
