/**
 * pill — the whole UI surface in one tainted-grey corner of the page.
 *
 * Design rule carried over from the interview: never silent. When something
 * breaks, the reason is readable in the pill, not a console-only whimper.
 */

import { MOVE_THINK_TIME_MS } from './autopilot';
import type { ArmResult, PilotStatus } from './autopilot';
import type { Side } from './chesscom';

export interface PillController {
  status(): PilotStatus;
  arm(): ArmResult;
  disarm(): void;
  skill(): number;
  cycleSkill(): number;
  myColor(): Side | null;
  /** cycles pinned color: auto → white → black → auto */
  cycleColor(): void;
  onStatusChange(cb: () => void): void;
}

const ID = 'pcfm-pill';

export function createPill(ctl: PillController): void {
  if (document.getElementById(ID)) return;

  const root = document.createElement('div');
  root.id = ID;
  root.style.cssText = [
    'position:fixed', 'bottom:12px', 'left:12px', 'z-index:2147483647',
    'font:600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    'background:#1c1c1eee', 'color:#d9d4c7', 'padding:8px 10px', 'border-radius:10px',
    'box-shadow:0 4px 16px #0008', 'display:flex', 'gap:6px', 'align-items:center',
    'user-select:none',
  ].join(';');

  const toggle = mkButton('ARM', armOrDisarm);
  toggle.style.background = '#e5e0d2';
  toggle.style.color = '#191919';

  const colorBtn = mkButton(colorLabel(ctl), () => ctl.cycleColor());
  colorBtn.title = 'Whose moves do I play? Click to cycle (auto → white → black).';

  const skillBtn = mkButton(skillLabel(ctl), () => {
    ctl.cycleSkill();
    colorBtn.textContent = colorLabel(ctl); // column widths stay stable enough
  });
  skillBtn.title = `Engine strength (UCI Skill Level). Think time is real: ${MOVE_THINK_TIME_MS[0]}–${MOVE_THINK_TIME_MS[1]} ms per move.`;

  const status = document.createElement('span');
  status.style.minWidth = '150px';

  const render = (): void => {
    const s = ctl.status();
    status.textContent = statusText(s);
    status.style.color = colorText(s);
    toggle.textContent = s.state === 'disarmed' || s.state === 'error' ? 'ARM' : 'STOP';
    colorBtn.textContent = colorLabel(ctl);
  };

  root.append(status, toggle, colorBtn, skillBtn);
  document.body.append(root);

  ctl.onStatusChange(render);
  render(); // initial paint

  function armOrDisarm(): void {
    const s = ctl.status();
    if (s.state === 'disarmed' || s.state === 'error' || s.state === 'over') {
      const r = ctl.arm();
      if (!r.ok) {
        status.textContent = `! ${r.error === 'no-color' ? 'which color do you play? tap the side button' : r.error === 'over' ? 'game already over' : 'already running'}`;
        status.style.color = '#f0b76b';
      }
    } else {
      ctl.disarm();
    }
  }
}

function mkButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = [
    'border:0', 'padding:5px 9px', 'border-radius:7px', 'cursor:pointer',
    'font:inherit', 'background:#333', 'color:#e8e3d5',
  ].join(';');
  b.addEventListener('click', onClick);
  return b;
}

function colorLabel(ctl: PillController): string {
  const pin = ctl.myColor();
  const auto = pin === null;
  const who = auto ? '?' : pin === 'w' ? 'W' : 'B';
  return `color: ${who}`;
}

function skillLabel(ctl: PillController): string {
  return `str: ${ctl.skill()}`;
}

function statusText(s: PilotStatus): string {
  switch (s.state) {
    case 'disarmed': return 'off';
    case 'error':    return `paused: ${s.error}`;
    case 'waiting':  return 'on — waiting';
    case 'thinking': return 'on — thinking…';
    case 'playing':  return 'on — played';
    case 'over':     return 'game over — done';
  }
}

function colorText(s: PilotStatus): string {
  if (s.state === 'error') return '#f0b76b';
  if (s.state === 'thinking') return '#9fd49f';
  if (s.state === 'over') return '#b8b2a5';
  return '#d9d4c7';
}
