/**
 * DOM→FEN parser against synthesized chess.com-style markup. The bridge is
 * the production primary path; these tests pin the *fallback's* mapping so
 * chess.com renames can't silently produce fake-but-plausible boards.
 */
import { collectPieces, decodePieceCode, parseBoardTofen } from '@/lib/dom-fen';

/** Builds a piece element with chess.com-style classes. */
function pieceEl(square: number, pieceToken: string): string {
  return `<div class="piece ${pieceToken} square-${square}"></div>`;
}

const FILES = 'abcdefgh';
const BACK_RANK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

/**
 * (file, rank) → chess.com square index.
 * chess.com square-NN = col*10 + row where col/row are SCREEN coordinates:
 * white orientation: col = file, row = 9 - rank (rank 8 shows top).
 * flipped (viewer is black, whole board rotated 180°): col = 9 - file,
 * row = rank.
 */
function toSquare(fileChar: string, rank: number, flipped: boolean): number {
  const fileIdx = fileChar.charCodeAt(0) - 96; // a=1..h=8
  const col = flipped ? 9 - fileIdx : fileIdx;
  const row = flipped ? rank : 9 - rank;
  return col * 10 + row;
}

/** Full start position markup for either orientation.
 * Piece placements are board coordinates and DO NOT depend on the view;
 * only `toSquare` turns them into rendered square indices differently. */
function startMarkup(flipped: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const f = FILES[i];
    parts.push(pieceEl(toSquare(f, 8, flipped), `b${BACK_RANK[i]}`));
    parts.push(pieceEl(toSquare(f, 7, flipped), 'bp'));
    parts.push(pieceEl(toSquare(f, 2, flipped), 'wp'));
    parts.push(pieceEl(toSquare(f, 1, flipped), `w${BACK_RANK[i]}`));
  }
  return `<wc-chess-board${flipped ? ' class="flipped"' : ''}>${parts.join('')}</wc-chess-board>`;
}

function doc(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

test('decodePieceCode: both historical spellings and the ambiguous tokens', () => {
  expect(decodePieceCode('piece wp square-11')).toBe('P');
  expect(decodePieceCode('piece pw square-11')).toBe('P');
  expect(decodePieceCode('piece bp')).toBe('p');
  expect(decodePieceCode('piece bk')).toBe('k');
  expect(decodePieceCode('piece wb')).toBe('B'); // white bishop
  expect(decodePieceCode('piece bw')).toBe('B'); // bishop-white spelling
  expect(decodePieceCode('piece bb')).toBe('b'); // black bishop
  expect(decodePieceCode('square-45')).toBeNull(); // no piece token at all
});

test('collectPieces: squares and pieces roundtrip through our markup', () => {
  const root = doc(`${pieceEl(11, 'br')}${pieceEl(21, 'bn')}${pieceEl(41, 'bq')}${pieceEl(43, 'wp')}`);
  const found = collectPieces(root);
  expect(found).toHaveLength(4);
  const bySquare = new Map(found.map((f) => [f.col * 10 + f.row, f.piece]));
  expect(bySquare.get(41)).toBe('q');
  expect(bySquare.get(11)).toBe('r');
  expect(bySquare.get(43)).toBe('P');
  expect(bySquare.get(21)).toBe('n');
});

test('parseBoardTofen start position (white at bottom)', () => {
  const result = parseBoardTofen(doc(startMarkup(false)));
  if (!result) throw new Error('parse failed');
  expect(result.fen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  expect(result.orientation).toBe('w');
});

test('parseBoardTofen start position flipped (viewer plays black)', () => {
  const result = parseBoardTofen(doc(startMarkup(true)));
  if (!result) throw new Error('parse failed');
  // a symmetric start position reads the same, but orientation flips
  expect(result.fen.split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  expect(result.orientation).toBe('b');
});

test('parseBoardTofen clocks → side to move (bottom running = viewer)', () => {
  const html =
    startMarkup(false) +
    `<div id="board-layout-player-bottom"><div class="clock-component clock-player-turn">1:00</div></div>` +
    `<div id="board-layout-player-top"><div class="clock-component">1:00</div></div>`;
  const result = parseBoardTofen(doc(html));
  if (!result) throw new Error('parse failed');
  expect(result.fen.split(' ')[1]).toBe('w');
});

test('parseBoardTofen clocks → side to move (top running = opponent)', () => {
  const html =
    startMarkup(false) +
    `<div id="board-layout-player-bottom"><div class="clock-component">1:00</div></div>` +
    `<div id="board-layout-player-top"><div class="clock-component clock-player-turn">1:00</div></div>`;
  const result = parseBoardTofen(doc(html));
  if (!result) throw new Error('parse failed');
  expect(result.fen.split(' ')[1]).toBe('b');
});

test('flipped board mirrors files AND ranks (rotation, not a vertical flip)', () => {
  // a black bishop that belongs at d4 renders, in a flipped board, at
  // col 9-4=5, row 4 → square 54; kings so the board is legal
  const root = doc(
    `<wc-chess-board class="flipped">${pieceEl(54, 'bb')}${pieceEl(11, 'bk')}${pieceEl(81, 'wk')}</wc-chess-board>`,
  );
  const result = parseBoardTofen(root);
  if (!result) throw new Error('parse failed');
  const placement = result.fen.split(' ')[0].split('/');
  expect(placement[4]).toBe('3b4'); // d4: 3 empties, bishop on d, 4 empties
  // bk at square-11 → file h, rank 1 → h1 ('k' ends the last rank row)
  expect(placement[7].endsWith('k')).toBe(true);
  // wk at square-81 → file a, rank 1 → a1 ('K' starts the last rank row)
  expect(placement[7][0]).toBe('K');
  expect(result.orientation).toBe('b');
});

test('unknown markup → null, never a fake board', () => {
  expect(parseBoardTofen(doc('<div>chess site</div>'))).toBeNull();
  // one king only: impossible live position, refuse
  expect(parseBoardTofen(doc(pieceEl(45, 'wk')))).toBeNull();
  // pieces without squares also refuse
  expect(
    parseBoardTofen(doc('<wc-chess-board><div class="piece wp"></div></wc-chess-board>')),
  ).toBeNull();
});
