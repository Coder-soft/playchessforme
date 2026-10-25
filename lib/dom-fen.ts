/**
 * DOM→FEN scrape — the pure, fixture-testable heart of the DOM adapter.
 *
 * chess.com encodes board state in CSS classes: each piece renders as an
 * element with a piece code (`wp`, `bk`, …) and a square index (`square-41`),
 * where the index is `column*10 + row`:
 *   - columns 1..8 left→right in white orientation (a→h)
 *   - rows 1..8 top→bottom, so row 1 is rank 8 (white) / rank 1 (flipped)
 * so `square-11` = a8, `square-88` = h1. The `flipped` board class means the
 * viewer plays black and the view mirrors both axes.
 *
 * This is the *fallback* adapter: when chess.com renames classes, parseBoard
 * returns null instead of inventing a board — silence is the wrong failure.
 * Page-scope bridge (lib/chesscom.ts) always takes priority in production.
 */

export type Side = 'w' | 'b';

export interface BoardTofenResult {
  fen: string;
  /** Viewer's orientation: 'w' = white at the bottom of the screen. */
  orientation: Side;
}

const COLORS = 'wb';
const PIECES = 'pnbrqk';

interface PlacedPiece {
  col: number; // 1..8, left→right on screen
  row: number; // 1..8, top→bottom on screen
  piece: string; // 'P','N','B','R','Q','K' or lowercase
}

/** Element tree → every (square, piece) pair we can make sense of. */
export function collectPieces(root: Element): PlacedPiece[] {
  const out: PlacedPiece[] = [];
  const candidates = root.querySelectorAll('.piece, piece');
  for (const el of Array.from(candidates)) {
    const cls = typeof el.className === 'string' ? el.className : '';
    const squareMatch = cls.match(/square-(\d{1,2})/);
    if (!squareMatch) continue;
    const square = Number.parseInt(squareMatch[1], 10);
    if (!Number.isFinite(square) || square < 11 || square > 88) continue;

    const col = Math.floor(square / 10);
    const row = square % 10;
    if (col < 1 || col > 8 || row < 1 || row > 8) continue;

    const piece = decodePieceCode(cls);
    if (piece) out.push({ col, row, piece });
  }
  return out;
}

/**
 * Piece codes appear as both spellings historically (`wp` white-pawn and
 * `pw` pawn-white), and `bb`/`wb` are legitimately ambiguous token *strings*
 * that still decode uniquely (one char must be a color letter, the other a
 * piece letter). Returns SAN-style: uppercase white, lowercase black.
 */
export function decodePieceCode(className: string): string | null {
  for (const token of className.split(/\s+/)) {
    if (token.length !== 2) continue;
    const [c0, c1] = token;
    if (COLORS.includes(c0) && PIECES.includes(c1)) return asSan(c0, c1);
    if (COLORS.includes(c1) && PIECES.includes(c0)) return asSan(c1, c0);
  }
  return null;
}

function asSan(color: string, piece: string): string {
  return color === 'w' ? piece.toUpperCase() : piece;
}

export function parseBoardTofen(root: Element): BoardTofenResult | null {
  const board = root.matches('wc-chess-board, chess-board')
    ? root
    : root.querySelector('wc-chess-board, chess-board');
  if (!board) return null;

  const pieces = collectPieces(board);
  if (pieces.length < 2) return null; // never a real live position
  if (pieces.filter((p) => p.piece.toLowerCase() === 'k').length !== 2) return null;

  const flipped = board.classList.contains('flipped');
  const orientation: Side = flipped ? 'b' : 'w';

  // grid[0] = rank 8 … grid[7] = rank 1 (FEN order)
  const grid: string[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ''));
  for (const { col, row, piece } of pieces) {
    const rank = flipped ? row : 9 - row;
    const file0 = flipped ? 8 - col : col - 1;
    grid[8 - rank][file0] = piece;
  }

  const placement = grid.map((row) => row.reduce(fenRun, '')).join('/');

  // The bridge is the real FEN source; the DOM fallback only emits *a* valid
  // position for reads — it is never used for blind play (playMove rejects).
  return {
    fen: `${placement} ${turnFromClocks(root, orientation)} - - 0 1`,
    orientation,
  };
}

/** One FEN rank row (8 cells), collapsing empty squares into digits. */
function fenRun(fen: string, sq: string): string {
  if (sq) return fen + sq;
  const last = fen[fen.length - 1];
  if (last && /\d/.test(last)) return fen.slice(0, -1) + String(Number(last) + 1);
  return fen + '1';
}

/** Side to move from the proven clock-turn markers, orientation-aware. */
function turnFromClocks(root: Element, orientation: Side): Side {
  const running = (panel: Element | null) =>
    panel?.querySelector('.clock-component')?.classList.contains('clock-player-turn') ?? false;
  const bottom = root.querySelector('#board-layout-player-bottom');
  const top = root.querySelector('#board-layout-player-top');

  if (running(bottom)) return orientation; // bottom panel = viewer's side
  if (running(top)) return orientation === 'w' ? 'b' : 'w';
  return 'w'; // unknown — read-only adapter, so this is informational only
}
