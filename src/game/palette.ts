/**
 * The bridge between the design system and the canvas.
 *
 * The renderer never hardcodes a colour. It reads the same custom properties
 * the HUD uses, so a token change moves the DOM and the pixels together. That
 * is the whole claim of the original system, made testable: swap --env and the
 * arena, the HUD and the particles all shift at once.
 *
 * Values are resolved once per environment change rather than per frame,
 * because getComputedStyle is far too slow to sit inside a game loop.
 */

export type Role =
  | 'background'
  | 'surface'
  | 'surface-raised'
  | 'primary'
  | 'health'
  | 'nano'
  | 'hostile'
  | 'friendly'
  | 'objective'
  | 'warning'
  | 'disabled'
  | 'ink'
  | 'ink-dim'
  | 'ink-faint'
  | 'arena-ground'
  | 'mark-hostile'
  | 'mark-friendly'
  | 'mark-objective'
  | 'mark-round'
  | 'mark-player';

const ROLES: Role[] = [
  'background',
  'surface',
  'surface-raised',
  'primary',
  'health',
  'nano',
  'hostile',
  'friendly',
  'objective',
  'warning',
  'disabled',
  'ink',
  'ink-dim',
  'ink-faint',
  'arena-ground',
  'mark-hostile',
  'mark-friendly',
  'mark-objective',
  'mark-round',
  'mark-player',
];

let cache: Record<Role, string> = {} as Record<Role, string>;

/*
 * Resolve a token to a literal sRGB triple.
 *
 * The first version read the computed `color` off a probe element, on the
 * assumption that computed colour is always serialised as rgb(). It is not: a
 * value authored in oklch computes to an oklch string, so every token came back
 * in a syntax canvas can fill with but colourAlpha cannot take apart. The alpha
 * was silently dropped, which meant the arena wash, the particle fade and the
 * floater fade were all painting at full opacity, and the backdrop was covered
 * by what was supposed to be a 30% veil.
 *
 * Painting the colour into a one-pixel canvas and reading the bytes back gives
 * real channel values for any syntax the browser accepts, in the same colour
 * space the game composites in.
 */
const probeCanvas = typeof document === 'undefined' ? null : document.createElement('canvas');
if (probeCanvas) {
  probeCanvas.width = 1;
  probeCanvas.height = 1;
}
const probeCtx = probeCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;

function resolve(role: Role): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${role}`)
    .trim();
  if (!raw || !probeCtx) return raw || '#ffffff';

  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillStyle = '#000000';
  probeCtx.fillStyle = raw;
  probeCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

export function refreshPalette(): void {
  cache = ROLES.reduce(
    (acc, role) => {
      acc[role] = resolve(role);
      return acc;
    },
    {} as Record<Role, string>,
  );
}

export function colour(role: Role): string {
  return cache[role] ?? '#ffffff';
}

/** The same role at partial alpha, for washes, trails and particles. */
export function colourAlpha(role: Role, alpha: number): string {
  const base = colour(role);
  const match = base.match(/rgba?\(([^)]+)\)/);
  // resolve() guarantees rgb(), so a miss means the cache was never built.
  // Returning the opaque colour here is what hid the dropped-alpha bug, so it
  // now fails loudly in development instead.
  if (!match) {
    console.error(`colourAlpha could not parse "${base}" for role "${role}"`);
    return base;
  }
  const [r, g, b] = match[1].split(',').map((part) => parseFloat(part));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Motion durations, read from the same tokens the CSS transitions use. */
export function duration(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--dur-${name}`)
    .trim();
  if (!raw) return fallback;
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return raw.endsWith('ms') ? value : value * 1000;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
