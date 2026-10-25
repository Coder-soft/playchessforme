/**
 * Engine host — background side of the engine seam.
 *
 * One runtime router, two adapters:
 *  - Chrome MV3: requests are forwarded to an offscreen document (service
 *    workers can't spawn workers). The offscreen doc runs Stockfish and
 *    answers; this script pipes the answer back to the content script.
 *  - Firefox MV3: the background IS an event page (full DOM access), so the
 *    engine worker lives right here.
 *
 * Contract (content script side):
 *   sendMessage({kind:'pcfm', type:'req/engine', @type EngineRequest})
 *     -> Promise<{move?:string} | {error:string}>
 */
import { createUciEngine, type EngineOptions, type UciEngine, type WorkerLike } from './engine';

/** Factory now shared with the offscreen document page. */
export function createFirefoxEngine(): Promise<UciEngine> {
  const worker = new Worker(assetUrl('engine/stockfish-19-lite-single.js'));
  const engine = createUciEngine(worker as unknown as WorkerLike);
  return engine.init().then(() => engine);
}

/** Same story as offscreen-main: engine assets aren't in the PublicPath union. */
const assetUrl = (path: string): string =>
  (browser.runtime.getURL as unknown as (p: string) => string)(path);

export async function serveFirefox(
  enginePromise: Promise<UciEngine>,
  fen: string,
  opts: EngineOptions & { movetimeMs: number },
): Promise<{ move?: string; error?: string }> {
  try {
    const engine = await enginePromise;
    return { move: await engine.bestMove(fen, opts) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function ensureOffscreen(): Promise<void> {
  const getContexts = (browser.runtime as unknown as {
    getContexts?: (o: { contextTypes: string[] }) => Promise<unknown[]>;
  }).getContexts;
  if (getContexts) {
    const existing = await getContexts.call(browser.runtime, {
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existing?.length) return;
  }

  const { offscreen } = (globalThis as unknown as {
    chrome?: { offscreen?: OffscreenChromeApi };
  }).chrome ?? {};
  if (!offscreen?.createDocument) {
    throw new Error('chrome.offscreen is unavailable in this context');
  }
  await offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Runs the Stockfish WASM engine for playchessforme.',
  });

  // give the new document a moment to boot its worker before first use
  await new Promise((r) => setTimeout(r, 750));
}

interface OffscreenChromeApi {
  createDocument(args: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
}
