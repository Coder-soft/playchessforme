/**
 * page-bridge — chess.com's page-scope JS, wired to the content script.
 *
 * chess.com leaves its game controller on the page scope (`game.getFEN()`,
 * `game.getLegalMoves()`, `game.move()` — the exact functions the site's own
 * UI calls). This unlisted script is injected as a plain <script> tag by the
 * content script, so it runs in *page scope*, accesses that controller, and
 * relays everything over window.postMessage with a 'pcfm' marker.
 *
 * Access patterns verified against the 2026 chess.com client by the chess-tui
 * project (board element `chess-board`/`wc-chess-board` exposing `.game`,
 * viewer identity via `window.context.user.username`, game over via
 * `.game-over-message-component`). If chess.com renames this, the bridge
 * simply stays dead and the extension falls back to the watch-only DOM
 * adapter — failing visible, never playing garbage.
 */

const CONTENT_SOURCE = 'pcfm-content';
const PAGE_SOURCE = 'pcfm-page';
const POLL_MS = 250;

const BOARD_SELECTORS = ['chess-board', 'wc-chess-board'];

interface ChessGameRecord {
  getFEN?: () => string;
  getLegalMoves?: () => unknown[];
  move?: (mv: Record<string, unknown>) => unknown;
  players?: unknown;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord | null {
  return typeof v === 'object' && v !== null ? (v as UnknownRecord) : null;
}

function getGame(): ChessGameRecord | null {
  for (const sel of BOARD_SELECTORS) {
    const board = document.querySelector(sel) as (Element & { game?: ChessGameRecord }) | null;
    if (board?.game) return board.game;
  }
  return null;
}

function readFen(): string | null {
  const game = getGame();
  if (!game || typeof game.getFEN !== 'function') return null;
  try {
    const fen = String(game.getFEN());
    return /^\S+\s+[wb]\s+/.test(fen) ? fen : null; // shape-gate: no partial FENs
  } catch {
    return null;
  }
}

const VIEWER_USERNAME_FALLBACK = 'viewer';

function viewerUsername(): string {
  const win = window as Window & { context?: UnknownRecord; chesscom?: UnknownRecord };
  const fromContext = asRecord(asRecord(win.context)?.user)?.username;
  if (typeof fromContext === 'string' && fromContext.trim()) return fromContext.trim();
  const fromChesscom = asRecord(asRecord(win.chesscom)?.user)?.username;
  if (typeof fromChesscom === 'string' && fromChesscom.trim()) return fromChesscom.trim();

  const profileLink = document.querySelector<HTMLAnchorElement>(
    'a[href*="/member/"][data-user-activity-key="profile"], a.sidebar-link[href*="/member/"]',
  );
  const match = profileLink?.getAttribute('href')?.match(/\/member\/([^/?#]+)/i);
  const name = match?.[1] ? decodeURIComponent(match[1]).trim() : '';
  return name || VIEWER_USERNAME_FALLBACK;
}

/** Board orientation: 'b' means viewer is black (cards at bottom are black). */
function orientation(board: Element): 'w' | 'b' {
  return board.classList.contains('flipped') ? 'b' : 'w';
}

function readMeColor(): 'w' | 'b' | null {
  const board = document.querySelector(BOARD_SELECTORS.join(','));
  if (!board) return null;
  const me = viewerUsername();
  if (me === VIEWER_USERNAME_FALLBACK) return orientation(board);

  // Player panels expose usernames; if both are visible, prefer explicit match.
  const read = (id: string): string | null =>
    document
      .getElementById(id)
      ?.querySelector('[data-test-element="user-tagline-username"]')
      ?.textContent?.trim()
      .toLowerCase() ?? null;
  const bottom = read('board-layout-player-bottom');
  const top = read('board-layout-player-top');
  const mine = me.toLowerCase();

  if (bottom === mine) return orientation(board);
  if (top === mine) return orientation(board) === 'w' ? 'b' : 'w';
  return orientation(board); // usernames unreadable → trust the orientation
}

function resultMessage(): string | null {
  const el = document.querySelector('.game-over-message-component');
  const text = el?.textContent?.replace(/\s+/g, ' ').trim();
  return text || null;
}

function emit(type: 'ready' | 'state' | 'over', extra: UnknownRecord = {}): void {
  const board = document.querySelector(BOARD_SELECTORS.join(','));
  const fen = readFen();
  if (!fen) return;

  window.postMessage(
    {
      source: PAGE_SOURCE,
      target: CONTENT_SOURCE,
      type,
      fen,
      me: readMeColor(),
      over: type === 'over' ? true : !!resultMessage(),
      resultMessage: resultMessage() ?? undefined,
      orientation: board ? orientation(board) : undefined,
      ...extra,
    },
    '*',
  );
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function normalizeSquare(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 2).toLowerCase() : '';
}

/** Finds chess.com's own legal-move record so game.move() gets its native shape. */
function findLegalMove(game: ChessGameRecord, uci: string): UnknownRecord | null {
  if (!UCI_RE.test(uci) || typeof game.getLegalMoves !== 'function') return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.length === 5 ? uci[4] : '';

  const moves = game.getLegalMoves();
  if (!Array.isArray(moves)) return null;

  for (const entry of moves) {
    const mv = asRecord(entry);
    if (!mv) continue;
    const mvFrom = normalizeSquare(mv.from ?? mv.start ?? mv.source);
    const mvTo = normalizeSquare(mv.to ?? mv.end ?? mv.target);
    if (mvFrom !== from || mvTo !== to) continue;
    const mvPromo = normalizeSquare(mv.promotion)?.slice(0, 1) ?? '';
    // chess.com's own move records put promotion in `promotion` — accept what
    // the board says; if it disagrees with the engine we bail (fail loudly).
    if (promo && mvPromo && mvPromo !== promo) return null;
    return mv;
  }
  return null;
}

interface PendingPlay {
  resolve: (ok: boolean, error?: string) => void;
}
const pendingPlays = new Map<string, PendingPlay>();
let reqSeq = 0;

function applyMove(uci: string): { ok: boolean; error?: string } {
  const game = getGame();
  if (!game || typeof game.move !== 'function') {
    return { ok: false, error: 'chess.com game controller not available' };
  }
  const legal = findLegalMove(game, uci);
  if (!legal) {
    return { ok: false, error: `engine move not legal for this position: ${uci}` };
  }
  const payload: UnknownRecord = { ...legal, animate: false, userGenerated: true };
  const promo = uci.length === 5 ? uci[4] : '';
  if (promo) payload.promotion = promo;

  try {
    game.move(payload);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (promo) {
    // Same promotion dialog the UI opens after a drag; finish it for them.
    setTimeout(() => {
      const piece = document.querySelector(`.promotion-piece.${promo}`) as HTMLElement | null;
      piece?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      piece?.click();
    }, 60);
  }
  return { ok: true };
}

export default defineUnlistedScript(() => {
  window.addEventListener('message', (event) => {
    const data = event.data as UnknownRecord | null;
    if (event.source !== window || typeof data !== 'object' || data === null) return;
    if (data.source !== CONTENT_SOURCE || data.target !== PAGE_SOURCE) return;

    if (data.type === 'play') {
      const reqId = typeof data.reqId === 'string' ? data.reqId : '';
      const uci = typeof data.uci === 'string' ? data.uci : '';
      if (!reqId || !uci) return;
      const result = applyMove(uci);
      window.postMessage(
        { source: PAGE_SOURCE, target: CONTENT_SOURCE, type: 'move-result', reqId, ...result },
        '*',
      );
    }
  });

  // Heartbeat: emit state on FEN change, poll fast, mind the game-over banner.
  let lastFen = '';
  let lastSig = '';

  window.setInterval(() => {
    const board = document.querySelector(BOARD_SELECTORS.join(','));
    const fen = readFen();
    if (!board || !fen) return;

    const over = resultMessage();
    const sig = `${fen}|${over ?? ''}|${readMeColor() ?? ''}`;
    if (sig === lastSig) return;

    const type = over ? 'over' : lastFen === '' ? 'ready' : 'state';
    lastFen = fen;
    lastSig = sig;
    emit(type);
  }, POLL_MS);
});
