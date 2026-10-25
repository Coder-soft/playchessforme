/**
 * chesscom module — the external seam between autopilot and the chess.com page.
 *
 * Interface (what the autopilot may know):
 *   GameState { fen, turn, me, over, resultMessage }
 *   adapter.watch(cb)  — cb fires immediately with the current state, then on
 *                        every change. States carry `me` when the adapter can
 *                        figure out which side the viewer plays.
 *   adapter.playMove(uci) — resolves when the move went in; rejects with the
 *                        reason when it did not (that throw is the fail-safe
 *                        that disarms the autopilot).
 *
 * Adapters behind the same interface:
 *   - bridge: page-scope JS (game.getFEN / game.move) — both reads and writes
 *   - dom:    CSS-class scraping — reads only; think of it as a teletype feed
 *             (it can watch a game but cannot play, and its playMove rejects).
 */

export type Side = 'w' | 'b';

export interface GameState {
  fen: string;
  turn: Side;
  /** Which side the viewer plays, when the page tells us. */
  me: Side | null;
  over: boolean;
  resultMessage?: string;
}

export interface GameAdapter {
  readonly name: 'bridge' | 'dom';
  watch(cb: (s: GameState) => void): void;
  latest(): GameState | null;
  playMove(uci: string): Promise<void>;
}

/**
 * One bridge adapter per document, no matter how many times the wiring loop
 * retries — each instance adds a window 'message' listener and re-injecting
 * the page script would stack duplicate pollers.
 */
const BRIDGE_WAIT_MS = 3500;
let bridgeSingleton: (GameAdapter & { waitReady(ms: number): Promise<boolean>; alive(): boolean }) | null = null;

function getBridge(): GameAdapter & { waitReady(ms: number): Promise<boolean>; alive(): boolean } {
  bridgeSingleton ??= createBridgeAdapter();
  return bridgeSingleton;
}

async function waitForBridge(): Promise<GameAdapter | null> {
  const adapter = getBridge();
  const ready = await adapter.waitReady(BRIDGE_WAIT_MS);
  return ready ? adapter : null;
}

/**
 * Selection, in order:
 *   1. bridge ready (a readable game is flowing)  → play-capable
 *   2. bridge alive but gameless — chess.com still spawns the real controller
 *      later (SPA Quick Pairing, slow loads). Null so the wiring loop keeps
 *      polling; a board-without-game must not wire the watch-only fallback
 *      and lock the document out of play capability for its whole life.
 *   3. bridge never ran (CSP-blocked / page-bridge broken) + a board exists
 *      → watch-only DOM fallback, visible in the pill.
 *   4. no board at all → null; not a game page, don't litter the DOM.
 */
export async function openGame(): Promise<GameAdapter | null> {
  const bridge = await waitForBridge();
  if (bridge) {
    console.info('[pcfm] page-scope bridge is up');
    return bridge;
  }
  if (getBridge().alive()) return null; // bridge healthy; game not here yet
  const dom = await openDomAdapter();
  if (dom) {
    console.warn('[pcfm] bridge unavailable — DOM fallback active (watch-only)');
    return dom;
  }
  return null;
}

async function openDomAdapter(): Promise<GameAdapter | null> {
  if (!document.querySelector('wc-chess-board, chess-board')) return null;
  const { createDomAdapter } = await import('./dom-adapter');
  return createDomAdapter();
}

/* ── bridge adapter ─────────────────────────────────────────────────────── */

const PAGE_SOURCE = 'pcfm-page';
const CONTENT_SOURCE = 'pcfm-content';
const MOVE_TIMEOUT_MS = 10_000;

export function createBridgeAdapter(): GameAdapter & { waitReady(ms: number): Promise<boolean>; alive(): boolean } {
  let ready = false;
  let isAlive = false;
  let latestState: GameState | null = null;
  const watchers = new Set<(s: GameState) => void>();
  const pendingMoves = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  let reqSeq = 0;

  function injectPageScript(): void {
    if (document.querySelector('script[src$="page-bridge.js"]')) return; // SPA: it's already out there
    const el = document.createElement('script');
    el.src = browser.runtime.getURL('/page-bridge.js');
    document.documentElement.prepend(el);
  }

  function onWindowMessage(event: MessageEvent): void {
    const data = event.data as Record<string, unknown> | null;
    if (event.source !== window || typeof data !== 'object' || data === null) return;
    if (data.source !== PAGE_SOURCE || data.target !== CONTENT_SOURCE) return;

    if (data.type === 'birth') {
      alive = true;
      return;
    }
    if (data.type === 'ready') {
      ready = true;
      return;
    }
    if (typeof data.fen === 'string') {
      latestState = {
        fen: data.fen as string,
        turn: data.fen.split(' ')[1] === 'b' ? 'b' : 'w',
        me: (data.me === 'w' || data.me === 'b' ? data.me : null) as Side | null,
        over: data.over === true,
        resultMessage: typeof data.resultMessage === 'string' ? data.resultMessage : undefined,
      };
      if (data.type === 'over') latestState.over = true;
      for (const cb of watchers) cb(latestState);
      return;
    }
    if (data.type === 'move-result' && typeof data.reqId === 'string') {
      const pending = pendingMoves.get(data.reqId);
      if (pending) {
        pendingMoves.delete(data.reqId);
        if (data.ok === true) pending.resolve();
        else pending.reject(new Error(String(data.error ?? 'move rejected by chess.com')));
      }
    }
  }

  window.addEventListener('message', onWindowMessage);
  injectPageScript();

  return {
    name: 'bridge',
    waitReady(ms) {
      const start = Date.now();
      return new Promise((resolve) => {
        const t = setInterval(() => {
          if (ready || Date.now() - start > ms) {
            clearInterval(t);
            resolve(ready);
          }
        }, 120);
      });
    },
    alive: () => isAlive,
    watch(cb) {
      watchers.add(cb);
      if (latestState) cb(latestState);
    },
    latest: () => latestState,
    playMove(uci) {
      if (ready) {
        const reqId = `m${++reqSeq}`;
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('chess.com never accepted our move')), MOVE_TIMEOUT_MS);
          pendingMoves.set(reqId, {
            resolve: () => {
              clearTimeout(timer);
              resolve();
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          });
          window.postMessage({ source: CONTENT_SOURCE, target: PAGE_SOURCE, type: 'play', reqId, uci }, '*');
        });
      }
      // DOM adapter's teletype mode: no write channel at all.
      return Promise.reject(new Error('page bridge is down; refusing to send a blind move'));
    },
  };
}
