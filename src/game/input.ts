/**
 * Input.
 *
 * The original brief targets an Xbox controller as the primary input, so the
 * gamepad is a first-class path rather than an afterthought, and the button
 * prompts on screen follow whichever device was used last. Keyboard and mouse
 * do everything the pad does, and nothing in the game is reachable by only one
 * of them.
 */

export type Device = 'pad' | 'keyboard';

export interface InputFrame {
  move: { x: number; y: number };
  aim: { x: number; y: number };
  /** True while the fire control is held. */
  fire: boolean;
  ability1: boolean;
  ability2: boolean;
  confirm: boolean;
  cancel: boolean;
  pause: boolean;
  device: Device;
}

const held = new Set<string>();
let pointer = { x: 0, y: 0, down: false };
let lastDevice: Device = 'keyboard';
const edges = new Set<string>();

/** Canvas rect, kept current so pointer aim maps into world space. */
let canvasRect: DOMRect | null = null;
let worldSize = { w: 480, h: 270 };

export function attachInput(canvas: HTMLCanvasElement, world: { w: number; h: number }): void {
  worldSize = world;
  const updateRect = () => {
    canvasRect = canvas.getBoundingClientRect();
  };
  updateRect();
  window.addEventListener('resize', updateRect);
  window.addEventListener('scroll', updateRect, { passive: true });

  window.addEventListener('keydown', (event) => {
    // Space and the arrows scroll the page by default, which is intolerable in
    // a game that uses them to move.
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
    }
    if (!held.has(event.code)) edges.add(event.code);
    held.add(event.code);
    lastDevice = 'keyboard';
  });

  window.addEventListener('keyup', (event) => held.delete(event.code));
  window.addEventListener('blur', () => held.clear());

  canvas.addEventListener('pointermove', (event) => {
    updateRect();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    lastDevice = 'keyboard';
  });
  canvas.addEventListener('pointerdown', (event) => {
    updateRect();
    pointer.down = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  window.addEventListener('pointerup', () => {
    pointer.down = false;
  });

  window.addEventListener('gamepadconnected', () => {
    lastDevice = 'pad';
  });
}

const dead = (value: number, zone = 0.22): number =>
  Math.abs(value) < zone ? 0 : (value - Math.sign(value) * zone) / (1 - zone);

function pad(): Gamepad | null {
  const pads = navigator.getGamepads?.() ?? [];
  for (const candidate of pads) {
    if (candidate && candidate.connected) return candidate;
  }
  return null;
}

export function readInput(playerScreen: { x: number; y: number }): InputFrame {
  const gp = pad();
  const frame: InputFrame = {
    move: { x: 0, y: 0 },
    aim: { x: 0, y: 0 },
    fire: false,
    ability1: false,
    ability2: false,
    confirm: false,
    cancel: false,
    pause: false,
    device: lastDevice,
  };

  // Keyboard movement.
  if (held.has('KeyW') || held.has('ArrowUp')) frame.move.y -= 1;
  if (held.has('KeyS') || held.has('ArrowDown')) frame.move.y += 1;
  if (held.has('KeyA') || held.has('ArrowLeft')) frame.move.x -= 1;
  if (held.has('KeyD') || held.has('ArrowRight')) frame.move.x += 1;

  frame.fire = pointer.down || held.has('Space') || held.has('KeyJ');
  frame.ability1 = edges.has('Digit1') || held.has('KeyK');
  frame.ability2 = edges.has('Digit2') || held.has('KeyL');
  frame.confirm = edges.has('Enter') || edges.has('Space') || edges.has('KeyE');
  frame.cancel = edges.has('Escape') || edges.has('Backspace');
  frame.pause = edges.has('Escape') || edges.has('KeyP');

  // Pointer aim, mapped from screen space into the fixed world grid.
  if (canvasRect && canvasRect.width > 0) {
    const wx = ((pointer.x - canvasRect.left) / canvasRect.width) * worldSize.w;
    const wy = ((pointer.y - canvasRect.top) / canvasRect.height) * worldSize.h;
    frame.aim.x = wx - playerScreen.x;
    frame.aim.y = wy - playerScreen.y;
  }

  if (gp) {
    const [lx, ly, rx, ry] = [
      dead(gp.axes[0] ?? 0),
      dead(gp.axes[1] ?? 0),
      dead(gp.axes[2] ?? 0),
      dead(gp.axes[3] ?? 0),
    ];
    if (lx || ly) {
      frame.move.x = lx;
      frame.move.y = ly;
      lastDevice = 'pad';
      frame.device = 'pad';
    }
    if (rx || ry) {
      frame.aim.x = rx;
      frame.aim.y = ry;
      lastDevice = 'pad';
      frame.device = 'pad';
    }

    const button = (index: number) => gp.buttons[index]?.pressed ?? false;
    // Right trigger or A to fire, X and Y for the two ability slots, exactly
    // the mapping the motion table documents.
    if (button(7) || button(0)) {
      frame.fire = true;
      lastDevice = 'pad';
      frame.device = 'pad';
    }
    if (button(2)) frame.ability1 = true;
    if (button(3)) frame.ability2 = true;
    if (button(0)) frame.confirm = true;
    if (button(1)) frame.cancel = true;
    if (button(9)) frame.pause = true;

    // D-pad drives menus, so the pad can reach everything the keyboard can.
    if (button(12)) frame.move.y = -1;
    if (button(13)) frame.move.y = 1;
    if (button(14)) frame.move.x = -1;
    if (button(15)) frame.move.x = 1;
  }

  const length = Math.hypot(frame.move.x, frame.move.y);
  if (length > 1) {
    frame.move.x /= length;
    frame.move.y /= length;
  }

  return frame;
}

/** Clear one-shot presses. Called once per frame after the frame is consumed. */
export function endFrame(): void {
  edges.clear();
}

export function lastUsedDevice(): Device {
  return lastDevice;
}
