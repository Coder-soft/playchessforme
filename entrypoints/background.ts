/**
 * Background entrypoint — the engine host router.
 *
 * Content script              background                     engine worker
 * req/engine ────────────────▶ router ──Firefox──▶ inline engine (event page)
 *                        └─Chrome─▶ offscreen.html ──▶ engine (offscreen doc)
 * ◀──────────── promise  (sendResponse, async)
 *
 * Messages from the background to the offscreen document use type
 * 'req/engine-true' so the offscreen listener can ignore content-script
 * broadcasts of 'req/engine' (runtime broadcasts reach every context).
 */
import type { EngineRequest } from '@/lib/engine-client';
import { createFirefoxEngine, ensureOffscreen, serveFirefox } from '@/lib/engine-host';
import type { EngineOptions } from '@/lib/engine';

const firefoxEngineActive = import.meta.env.FIREFOX === true;

// Firefox keeps its engine warm in this event page; Chrome never touches this.
const firefoxEngine = firefoxEngineActive ? createFirefoxEngine() : null;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      msg: { kind?: string; type?: string; req?: EngineRequest },
      _sender,
      sendResponse,
    ) => {
      if (msg?.kind !== 'pcfm' || msg.type !== 'req/engine' || !msg.req) return false;
      const req: EngineRequest = msg.req;

      void (async () => {
        try {
          if (firefoxEngine) {
            sendResponse(await serveFirefox(firefoxEngine, req.fen, {
              skill: req.skill,
              movetimeMs: req.movetimeMs,
            } satisfies EngineOptions & { movetimeMs: number }));
          } else {
            await ensureOffscreen();
            sendResponse(
              await browser.runtime.sendMessage({
                kind: 'pcfm',
                type: 'req/engine-true',
                req,
              }),
            );
          }
        } catch (err) {
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        }
      })();

      return true; // async sendResponse
    },
  );
});
