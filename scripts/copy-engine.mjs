/**
 * Copies the browser single-threaded WASM Stockfish build from
 * node_modules/stockfish into public/engine/ so WXT ships it as a static asset.
 * The set of files we care about is tiny and explicit; if the package layout
 * changes, this script is the first thing to complain.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const pkgDir = join(root, 'node_modules/stockfish/bin');
const outDir = join(root, 'public/engine');

if (!existsSync(pkgDir)) {
  console.error('stockfish package missing — run `npm install` first');
  process.exit(1);
}

const files = readdirSync(pkgDir);
const want = [
  // Single-threaded WASM lite build: ~1.8MB, no cross-origin isolation needed,
  // worker-safe. Falling back would silently pick the multi-threaded build,
  // which requires SharedArrayBuffer headers extension pages never get, so we
  // list exact filenames.
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
];

const missing = want.filter((f) => !files.includes(f));
if (missing.length) {
  console.error('Expected engine files not found in node_modules/stockfish:');
  console.error(missing.join('\n'));
  console.error('Available files worth checking:');
  console.error(files.filter((f) => f.endsWith('.js') || f.endsWith('.wasm')).join('\n'));
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const f of want) copyFileSync(join(pkgDir, f), join(outDir, f));
console.log('engine assets copied:', want.join(', '));
