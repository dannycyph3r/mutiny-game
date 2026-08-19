/**
 * Renderer.
 *
 * Draws the world at 480 by 270 and lets CSS scale it up with nearest-neighbour,
 * so every pixel is an honest pixel rather than a blur filter.
 *
 * The shape language from the colour documentation is enforced here and is the
 * reason the game is playable without colour at all: a hostile is a chevron, a
 * friendly is a circle, an objective is a diamond. Colour agrees with the shape,
 * it never carries the meaning by itself.
 */

import { colour, colourAlpha } from './palette';
import { SAFE, WORLD } from './world';
import type { GameState } from './types';

let backdrop: HTMLImageElement | null = null;
let backdropKey = '';

export function loadBackdrop(src: string): void {
  if (backdropKey === src) return;
  backdropKey = src;
  const image = new Image();
  image.src = src;
  image.onload = () => {
    backdrop = image;
  };
  image.onerror = () => {
    // A missing backdrop is not fatal: the arena still reads on the base colour.
    backdrop = null;
  };
}

/*
 * Every mark is drawn twice: once one pixel larger in the arena ground, then
 * again in its own colour. The plate is the reason a mark is readable over
 * photography at all. Tuning the wash was tried first and measured: no opacity
 * value gets a mid-lightness red to 3:1 against arbitrary art, and the values
 * that came closest erased the backdrop. A plate makes the ground under every
 * mark identical in both environments, so the marks are measured once and hold
 * everywhere, and the wash can stay light enough to leave the art visible.
 */
const PLATE = 1.5;

type Shape = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number) => void;

const chevron: Shape = (ctx, x, y, r, angle) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.6, -r);
  ctx.lineTo(-r * 0.2, 0);
  ctx.lineTo(-r * 0.6, r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const diamond: Shape = (ctx, x, y, r) => {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
};

const circle: Shape = (ctx, x, y, r) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

/*
 * The player is a cross, and that is a rule rather than a flourish. Chevron,
 * circle and diamond are spoken for, and drawing the player as a circle put the
 * thing you are steering into the same shape class as the thing that costs you
 * 250 points to shoot. A fourth silhouette keeps the language unambiguous.
 */
const cross: Shape = (ctx, x, y, r) => {
  const arm = r;
  const half = Math.max(1, r * 0.42);
  ctx.beginPath();
  ctx.rect(x - arm, y - half, arm * 2, half * 2);
  ctx.rect(x - half, y - arm, half * 2, arm * 2);
  ctx.fill();
};

/** Draw the ground plate, then the mark. */
function plated(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  x: number,
  y: number,
  r: number,
  fill: string,
  angle = 0,
): void {
  ctx.fillStyle = colour('arena-ground');
  shape(ctx, x, y, r + PLATE, angle);
  ctx.fillStyle = fill;
  shape(ctx, x, y, r, angle);
}

export interface RenderOptions {
  reduceEffects: boolean;
  showSafeZone: boolean;
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  options: RenderOptions,
): void {
  const { player } = state;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Screen shake, suppressed when effects are reduced.
  if (!options.reduceEffects && state.shake > 0.2) {
    const amount = state.shake;
    ctx.translate(
      Math.round((Math.random() - 0.5) * amount),
      Math.round((Math.random() - 0.5) * amount),
    );
  }

  // Backdrop, then a light wash. It exists to settle the art behind the action,
  // not to carry mark legibility: the plates do that.
  ctx.fillStyle = colour('arena-ground');
  ctx.fillRect(-8, -8, WORLD.w + 16, WORLD.h + 16);
  if (backdrop) {
    ctx.globalAlpha = 1;
    ctx.drawImage(backdrop, 0, 0, WORLD.w, WORLD.h);
    ctx.fillStyle = colourAlpha('arena-ground', state.environment === 'day' ? 0.42 : 0.30);
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  }

  // Safe-zone frame from the layout documentation, available as a toggle
  // because it is genuinely useful when tuning HUD placement.
  if (options.showSafeZone) {
    ctx.strokeStyle = colourAlpha('primary', 0.5);
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    ctx.strokeRect(SAFE.x, SAFE.y, WORLD.w - SAFE.x * 2, WORLD.h - SAFE.y * 2);
    ctx.setLineDash([]);
  }

  // Navigation: a line to the live objective. Only the current objective
  // animates, so attention has one destination.
  if (state.objectiveTarget) {
    const pulse = options.reduceEffects ? 0.5 : 0.35 + 0.25 * Math.sin(state.time / 320);
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(player.pos.x, player.pos.y);
    ctx.lineTo(state.objectiveTarget.x, state.objectiveTarget.y);
    ctx.strokeStyle = colourAlpha('arena-ground', 0.85);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = colourAlpha('mark-objective', pulse * 0.9);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Particles.
  for (const particle of state.particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = colourAlpha(particle.colour, alpha);
    ctx.fillRect(
      Math.round(particle.pos.x),
      Math.round(particle.pos.y),
      particle.size,
      particle.size,
    );
  }

  // Entities.
  for (const entity of state.entities) {
    const hit = state.time < entity.hitUntil;

    if (entity.kind === 'hostile') {
      const revealed = state.time < entity.revealedUntil;
      const angle = Math.atan2(player.pos.y - entity.pos.y, player.pos.x - entity.pos.x);

      if (revealed) {
        // Pulse Scan marks its targets with a ring, so the reveal is visible
        // without changing what the entity is.
        ctx.strokeStyle = colour('arena-ground');
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(entity.pos.x, entity.pos.y, entity.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = colourAlpha('nano', 0.9);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      plated(
        ctx,
        chevron,
        entity.pos.x,
        entity.pos.y,
        entity.radius,
        hit ? colour('mark-player') : colour('mark-hostile'),
        angle,
      );

      // Brutes carry a health pip so a long fight reads as progress.
      if (entity.maxHp > 4 && entity.hp < entity.maxHp) {
        const width = entity.radius * 2;
        ctx.fillStyle = colour('arena-ground');
        ctx.fillRect(entity.pos.x - width / 2 - 1, entity.pos.y - entity.radius - 6, width + 2, 4);
        ctx.fillStyle = colour('mark-hostile');
        ctx.fillRect(
          entity.pos.x - width / 2,
          entity.pos.y - entity.radius - 5,
          width * (entity.hp / entity.maxHp),
          2,
        );
      }
    } else if (entity.kind === 'friendly') {
      plated(ctx, circle, entity.pos.x, entity.pos.y, entity.radius, colour('mark-friendly'));
      // Hollowed so a friendly reads as a ring rather than a blob at 10px.
      ctx.fillStyle = colour('arena-ground');
      circle(ctx, entity.pos.x, entity.pos.y, entity.radius - 2, 0);
    } else {
      const bob = options.reduceEffects ? 0 : Math.sin(state.time / 240) * 1.5;
      plated(ctx, diamond, entity.pos.x, entity.pos.y + bob, entity.radius, colour('mark-objective'));
    }
  }

  // Bullets, plated like everything else so a round is never lost in the art.
  for (const bullet of state.bullets) {
    const bx = Math.round(bullet.pos.x);
    const by = Math.round(bullet.pos.y);
    ctx.fillStyle = colour('arena-ground');
    ctx.fillRect(bx - 2, by - 2, 4, 4);
    ctx.fillStyle = colour('mark-round');
    ctx.fillRect(bx - 1, by - 1, 2, 2);
  }

  // Player. Flashes on the documented 340ms impact window.
  const impact = state.time < player.hitUntil;
  const blinking =
    state.time < player.invulnerableUntil && Math.floor(state.time / 90) % 2 === 0;
  if (!blinking) {
    const length = Math.hypot(player.aim.x, player.aim.y) || 1;
    const dir = { x: player.aim.x / length, y: player.aim.y / length };

    // Barrel first, plated, so the player body draws over its root.
    ctx.lineCap = 'butt';
    ctx.strokeStyle = colour('arena-ground');
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(player.pos.x + dir.x * 3, player.pos.y + dir.y * 3);
    ctx.lineTo(player.pos.x + dir.x * 10, player.pos.y + dir.y * 10);
    ctx.stroke();
    ctx.strokeStyle = colour('mark-round');
    ctx.lineWidth = 2;
    ctx.stroke();

    plated(
      ctx,
      cross,
      player.pos.x,
      player.pos.y,
      player.radius,
      impact ? colour('warning') : colour('mark-player'),
    );
  }

  // Overdrive ring, so the active window is visible in the world and not only
  // on the HUD.
  if (state.time < state.abilities.overdrive.activeUntil) {
    ctx.beginPath();
    ctx.arc(player.pos.x, player.pos.y, player.radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = colour('arena-ground');
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = colour('mark-round');
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Floating score text.
  ctx.font = '600 8px ui-monospace, monospace';
  ctx.textAlign = 'center';
  for (const floater of state.floaters) {
    const alpha = Math.min(1, floater.life / 500);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = colourAlpha('arena-ground', alpha);
    ctx.strokeText(floater.text, Math.round(floater.pos.x), Math.round(floater.pos.y));
    ctx.fillStyle = colourAlpha(floater.colour, alpha);
    ctx.fillText(floater.text, Math.round(floater.pos.x), Math.round(floater.pos.y));
  }

  ctx.restore();

  // Scanlines and vignette. Both are static, with no flicker, so nothing here
  // can trigger a photosensitive response.
  if (!options.reduceEffects) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < WORLD.h; y += 2) {
      ctx.fillRect(0, y, WORLD.w, 1);
    }
    ctx.restore();

    const gradient = ctx.createRadialGradient(
      WORLD.w / 2,
      WORLD.h / 2,
      WORLD.h * 0.3,
      WORLD.w / 2,
      WORLD.h / 2,
      WORLD.h * 0.78,
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  }
}
