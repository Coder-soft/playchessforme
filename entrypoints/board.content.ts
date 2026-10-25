/**
 * content script — the wiring layer, nothing more.
 *
 * Chooses the chesscom adapter, constructs the autopilot with the engine
 * client, and builds the pill. Every module above this file has an
 * interface-only surface; content code is the single place where concrete
 * adapters get bound to names (the "main" of the design).
 */
import { Autopilot } from '@/lib/autopilot';
import { openGame, type Side } from '@/lib/chesscom';
import { requestBestMove } from '@/lib/engine-client';
import { createPill, type PillController } from '@/lib/pill';

export default defineContentScript({
  matches: ['*://www.chess.com/*'],
  runAt: 'document_idle',
  main() {
    void watchAndWire();
  },
});

/**
 * chess.com is an SPA: a live game can appear minutes after load (Quick
 * Pairing from home) or the whole page may load slowly, so a one-shot
 * openGame() misses far too easily. Retry on an interval until an adapter is
 * up and the pill exists — once wired, stop; the SPA watchdog's job is done.
 */
const WIRE_RETRY_MS = 2500;

async function watchAndWire(): Promise<void> {
  for (;;) {
    const adapter = await openGame();
    if (adapter) {
      await wire(adapter);
      return;
    }
    await new Promise((r) => setTimeout(r, WIRE_RETRY_MS));
  }
}

async function wire(adapter: GameAdapter): Promise<void> {

  const pinnedStored = await storage.getItem<string | null>('local:pcfm.color');
  const skillStored = await storage.getItem<number | null>('local:pcfm.skill');

  let pinnedColor: Side | null = pinnedStored === 'w' || pinnedStored === 'b' ? pinnedStored : null;
  let skill = typeof skillStored === 'number' ? skillStored : 8;

  const myColor = (): Side | null => adapter.latest()?.me ?? pinnedColor;

  const pilot = new Autopilot({
    game: adapter,
    engine: { bestMove: (req) => requestBestMove(req) },
    myColor,
    skill: () => skill,
    log: (m) => console.info('[pcfm]', m),
  });

  const ctl: PillController = {
    status: () => pilot.status(),
    arm: () => pilot.arm(),
    disarm: () => pilot.disarm(),
    skill: () => skill,
    cycleSkill() {
      const LADDER = [0, 2, 4, 6, 8, 10, 12, 14, 16, 20];
      const i = LADDER.indexOf(skill);
      const next = i < 0 ? 0 : LADDER[(i + 1) % LADDER.length] ?? LADDER[0] ?? 8;
      skill = next;
      void storage.setItem('local:pcfm.skill', skill);
      return skill;
    },
    myColor,
    cycleColor() {
      pinnedColor = pinnedColor === null ? 'w' : pinnedColor === 'w' ? 'b' : null;
      void storage.setItem('local:pcfm.color', pinnedColor as string | null);
    },
    onStatusChange: (cb) => pilot.onStatusChange(cb),
  };

  createPill(ctl);
  console.info('[pcfm] ready on', adapter.name, 'adapter');
}
