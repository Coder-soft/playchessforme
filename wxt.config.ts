import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'playchessforme',
    short_name: 'pcfm',
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { id: 'playchessforme@coder-soft.github.io' },
          },
        }
      : {}),
    description:
      "Autopilot for your chess.com live games. Detects the board, asks Stockfish, plays via chess.com's own board API. Checkmate, invariant: it must never move silently when something breaks.",
    permissions: browser === 'chrome' ? ['storage', 'offscreen'] : ['storage'],
    host_permissions: ['https://www.chess.com/*'],
    web_accessible_resources: [
      {
        resources: ['page-bridge.js'],
        matches: ['https://www.chess.com/*', 'https://chess.com/*'],
      },
    ],
    // Firefox MV3 wants our manually-injected page scripts to work too, so the
    // bridge is listed though scripting injection is done via <script> tag.
  }),
});
