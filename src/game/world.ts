/**
 * Simulation.
 *
 * Fixed world of 480 by 270, which is exactly a quarter of the 1920x1080
 * gameplay target in the brief and upscales to it by an integer factor. Keeping
 * the simulation in that space means positions are pixel-honest and the lo-fi
 * look is a property of the resolution rather than a filter applied on top.
 *
 * Every timing that has a documented value uses it. The ability window is
 * 1.4 seconds and the cooldown 2.8 seconds because the motion table says so,
 * and the game was balanced around those numbers rather than the reverse.
 */

import type {
  AbilityId,
  Floater,
  AbilityState,
  Entity,
  GameState,
  HostileClass,
  Particle,
  Upgrade,
} from './types';
import { play } from './audio';

export const WORLD = { w: 480, h: 270 };
/** Matches the 5% title-safe inset in the layout documentation. */
export const SAFE = { x: WORLD.w * 0.05, y: WORLD.h * 0.05 };

let nextId = 1;
const id = () => nextId++;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const ABILITY_SPECS: Record<AbilityId, Omit<AbilityState, 'activeUntil' | 'readyAt' | 'level'>> = {
  overdrive: {
    id: 'overdrive',
    name: 'DATA OVERDRIVE',
    description: 'Doubles fire rate and lets rounds pierce for the active window.',
    cost: 35,
    activeMs: 1400,
    cooldownMs: 2800,
  },
  pulse: {
    id: 'pulse',
    name: 'PULSE SCAN',
    description: "Reveals enemy locations in the player's cone of vision and slows them.",
    cost: 25,
    activeMs: 1400,
    cooldownMs: 2800,
  },
};

const HOSTILES: Record<HostileClass, { hp: number; speed: number; radius: number; damage: number; score: number }> = {
  walker: { hp: 3, speed: 26, radius: 5, damage: 8, score: 100 },
  runner: { hp: 2, speed: 48, radius: 4, damage: 6, score: 150 },
  brute: { hp: 9, speed: 17, radius: 8, damage: 18, score: 300 },
};

export function createState(environment: 'night' | 'day', arena: string): GameState {
  nextId = 1;
  return {
    phase: 'briefing',
    time: 0,
    player: {
      pos: { x: WORLD.w / 2, y: WORLD.h / 2 },
      vel: { x: 0, y: 0 },
      aim: { x: 1, y: 0 },
      radius: 5,
      hp: 100,
      maxHp: 100,
      nano: 100,
      maxNano: 100,
      speed: 64,
      fireRateMs: 170,
      damage: 1,
      lastShotAt: -9999,
      invulnerableUntil: 0,
      hitUntil: 0,
    },
    entities: [],
    bullets: [],
    particles: [],
    floaters: [],
    abilities: {
      overdrive: { ...ABILITY_SPECS.overdrive, activeUntil: 0, readyAt: 0, level: 1 },
      pulse: { ...ABILITY_SPECS.pulse, activeUntil: 0, readyAt: 0, level: 1 },
    },
    wave: 1,
    waveKillsNeeded: 9,
    waveKills: 0,
    spawnTimer: 0,
    combo: 0,
    comboUntil: 0,
    stats: {
      score: 0,
      wave: 1,
      kills: 0,
      civiliansLost: 0,
      objectivesTaken: 0,
      bestCombo: 0,
      shotsFired: 0,
      shotsHit: 0,
      startedAt: Date.now(),
      endedAt: 0,
    },
    shake: 0,
    freeze: 0,
    offeredUpgrades: [],
    objectiveTarget: null,
    environment,
    arena,
  };
}

function spawnEdge(): { x: number; y: number } {
  const side = Math.floor(Math.random() * 4);
  if (side === 0) return { x: Math.random() * WORLD.w, y: -8 };
  if (side === 1) return { x: WORLD.w + 8, y: Math.random() * WORLD.h };
  if (side === 2) return { x: Math.random() * WORLD.w, y: WORLD.h + 8 };
  return { x: -8, y: Math.random() * WORLD.h };
}

function pushFloater(state: GameState, x: number, y: number, text: string, colour: Floater['colour']) {
  state.floaters.push({ pos: { x, y }, text, life: 900, colour });
}

function burst(state: GameState, x: number, y: number, colour: Particle['colour'], count: number, power = 40) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = power * (0.3 + Math.random() * 0.7);
    state.particles.push({
      pos: { x, y },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      life: 320 + Math.random() * 280,
      maxLife: 600,
      colour,
      size: Math.random() < 0.3 ? 2 : 1,
    });
  }
}

function classForWave(wave: number): HostileClass {
  const roll = Math.random();
  if (wave >= 4 && roll < 0.18) return 'brute';
  if (wave >= 2 && roll < 0.5) return 'runner';
  return 'walker';
}

export function spawnHostile(state: GameState): void {
  const cls = classForWave(state.wave);
  const spec = HOSTILES[cls];
  // Hostiles get a little tougher each wave, but the shape and colour language
  // never changes: a chevron is always a chevron.
  const hp = spec.hp + Math.floor(state.wave / 3);
  state.entities.push({
    id: id(),
    kind: 'hostile',
    hostileClass: cls,
    pos: spawnEdge(),
    vel: { x: 0, y: 0 },
    radius: spec.radius,
    hp,
    maxHp: hp,
    speed: spec.speed * (1 + state.wave * 0.02),
    contactDamage: spec.damage,
    revealedUntil: 0,
    hitUntil: 0,
    dead: false,
  });
}

export function spawnFriendly(state: GameState): void {
  state.entities.push({
    id: id(),
    kind: 'friendly',
    pos: {
      x: SAFE.x + Math.random() * (WORLD.w - SAFE.x * 2),
      y: SAFE.y + Math.random() * (WORLD.h - SAFE.y * 2),
    },
    vel: { x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14 },
    radius: 5,
    hp: 1,
    maxHp: 1,
    speed: 14,
    contactDamage: 0,
    revealedUntil: 0,
    hitUntil: 0,
    dead: false,
  });
}

export function spawnObjective(state: GameState): void {
  const pos = {
    x: SAFE.x + Math.random() * (WORLD.w - SAFE.x * 2),
    y: SAFE.y + Math.random() * (WORLD.h - SAFE.y * 2),
  };
  state.entities.push({
    id: id(),
    kind: 'objective',
    pos,
    vel: { x: 0, y: 0 },
    radius: 5,
    hp: 1,
    maxHp: 1,
    speed: 0,
    contactDamage: 0,
    revealedUntil: 0,
    hitUntil: 0,
    dead: false,
  });
  state.objectiveTarget = pos;
}

export function tryAbility(state: GameState, which: AbilityId): 'used' | 'cooldown' | 'nano' {
  const ability = state.abilities[which];
  if (state.time < ability.readyAt) return 'cooldown';
  if (state.player.nano < ability.cost) return 'nano';

  state.player.nano -= ability.cost;
  ability.activeUntil = state.time + ability.activeMs;
  // Cooldown runs from the end of the active window: ready, activated,
  // cooldown, ready, exactly the cycle in the motion table.
  ability.readyAt = ability.activeUntil + ability.cooldownMs;
  play('ability');

  if (which === 'pulse') {
    const range = 120 + ability.level * 24;
    for (const entity of state.entities) {
      if (entity.kind !== 'hostile') continue;
      if (dist(entity.pos, state.player.pos) <= range) {
        entity.revealedUntil = ability.activeUntil;
      }
    }
    pushFloater(state, state.player.pos.x, state.player.pos.y - 12, 'SCAN', 'nano');
  } else {
    pushFloater(state, state.player.pos.x, state.player.pos.y - 12, 'OVERDRIVE', 'mark-round');
  }

  return 'used';
}

function fire(state: GameState): void {
  const { player } = state;
  const overdrive = state.abilities.overdrive;
  const boosted = state.time < overdrive.activeUntil;
  const rate = boosted ? player.fireRateMs / 2 : player.fireRateMs;
  if (state.time - player.lastShotAt < rate) return;

  player.lastShotAt = state.time;
  const length = Math.hypot(player.aim.x, player.aim.y) || 1;
  const dir = { x: player.aim.x / length, y: player.aim.y / length };

  state.bullets.push({
    id: id(),
    pos: { x: player.pos.x + dir.x * 6, y: player.pos.y + dir.y * 6 },
    vel: { x: dir.x * 230, y: dir.y * 230 },
    life: 1200,
    pierce: boosted ? 1 + overdrive.level : 0,
    damage: player.damage,
  });
  state.stats.shotsFired += 1;
  play('shoot');
}

function killHostile(state: GameState, entity: Entity): void {
  entity.dead = true;
  state.waveKills += 1;
  state.stats.kills += 1;

  const chained = state.time < state.comboUntil;
  state.combo = chained ? state.combo + 1 : 1;
  state.comboUntil = state.time + 3000;
  state.stats.bestCombo = Math.max(state.stats.bestCombo, state.combo);

  const multiplier = Math.min(8, 1 + Math.floor(state.combo / 3));
  const base = HOSTILES[entity.hostileClass ?? 'walker'].score;
  const gained = base * multiplier;
  state.stats.score += gained;

  pushFloater(state, entity.pos.x, entity.pos.y, `+${gained}`, 'mark-round');
  burst(state, entity.pos.x, entity.pos.y, 'mark-hostile', 10, 55);
  state.shake = Math.min(6, state.shake + 2);
  state.freeze = 2;
  play('kill');
}

function loseCivilian(state: GameState, entity: Entity): void {
  entity.dead = true;
  state.stats.civiliansLost += 1;
  // Breaking the combo is the whole point: the shape language is a mechanic,
  // not decoration. Firing before you have read the marker costs you.
  state.combo = 0;
  state.comboUntil = 0;
  state.stats.score = Math.max(0, state.stats.score - 250);
  pushFloater(state, entity.pos.x, entity.pos.y, '-250 FRIENDLY', 'mark-friendly');
  burst(state, entity.pos.x, entity.pos.y, 'mark-friendly', 12, 45);
  state.shake = 6;
  play('deny');
}

function damagePlayer(state: GameState, amount: number): void {
  const { player } = state;
  if (state.time < player.invulnerableUntil) return;

  player.hp = Math.max(0, player.hp - amount);
  player.invulnerableUntil = state.time + 700;
  player.hitUntil = state.time + 340; // the documented impact duration
  state.combo = 0;
  state.comboUntil = 0;
  state.shake = 8;
  play('hurt');

  if (player.hp <= 0) {
    state.phase = 'over';
    state.stats.endedAt = Date.now();
    state.stats.wave = state.wave;
  }
}

export interface StepInput {
  move: { x: number; y: number };
  aim: { x: number; y: number };
  fire: boolean;
}

/** One simulation step. dt is milliseconds and is clamped by the caller. */
export function step(state: GameState, dt: number, input: StepInput): void {
  if (state.phase !== 'playing') return;

  if (state.freeze > 0) {
    state.freeze -= 1;
    return;
  }

  state.time += dt;
  const seconds = dt / 1000;
  const { player } = state;

  // Movement.
  player.vel.x = input.move.x * player.speed;
  player.vel.y = input.move.y * player.speed;
  player.pos.x = clamp(player.pos.x + player.vel.x * seconds, player.radius, WORLD.w - player.radius);
  player.pos.y = clamp(player.pos.y + player.vel.y * seconds, player.radius, WORLD.h - player.radius);

  if (Math.hypot(input.aim.x, input.aim.y) > 0.1) {
    player.aim.x = input.aim.x;
    player.aim.y = input.aim.y;
  }

  if (input.fire) fire(state);

  // Nano regenerates slowly, so abilities are a rhythm rather than a spam.
  player.nano = Math.min(player.maxNano, player.nano + 6 * seconds);

  // Bullets.
  for (const bullet of state.bullets) {
    bullet.pos.x += bullet.vel.x * seconds;
    bullet.pos.y += bullet.vel.y * seconds;
    bullet.life -= dt;
  }
  state.bullets = state.bullets.filter(
    (bullet) =>
      bullet.life > 0 &&
      bullet.pos.x > -12 &&
      bullet.pos.x < WORLD.w + 12 &&
      bullet.pos.y > -12 &&
      bullet.pos.y < WORLD.h + 12,
  );

  // Entities.
  const pulseActive = state.time < state.abilities.pulse.activeUntil;
  for (const entity of state.entities) {
    if (entity.dead) continue;

    if (entity.kind === 'hostile') {
      const slow = pulseActive && state.time < entity.revealedUntil ? 0.45 : 1;
      const dx = player.pos.x - entity.pos.x;
      const dy = player.pos.y - entity.pos.y;
      const length = Math.hypot(dx, dy) || 1;
      entity.pos.x += (dx / length) * entity.speed * slow * seconds;
      entity.pos.y += (dy / length) * entity.speed * slow * seconds;

      if (dist(entity.pos, player.pos) < entity.radius + player.radius) {
        damagePlayer(state, entity.contactDamage);
      }
    } else if (entity.kind === 'friendly') {
      // Civilians wander and bounce off the frame.
      entity.pos.x += entity.vel.x * seconds;
      entity.pos.y += entity.vel.y * seconds;
      if (entity.pos.x < SAFE.x || entity.pos.x > WORLD.w - SAFE.x) entity.vel.x *= -1;
      if (entity.pos.y < SAFE.y || entity.pos.y > WORLD.h - SAFE.y) entity.vel.y *= -1;
      entity.pos.x = clamp(entity.pos.x, SAFE.x, WORLD.w - SAFE.x);
      entity.pos.y = clamp(entity.pos.y, SAFE.y, WORLD.h - SAFE.y);
    } else if (entity.kind === 'objective') {
      if (dist(entity.pos, player.pos) < entity.radius + player.radius + 2) {
        entity.dead = true;
        state.stats.objectivesTaken += 1;
        state.stats.score += 200;
        player.nano = Math.min(player.maxNano, player.nano + 35);
        state.objectiveTarget = null;
        pushFloater(state, entity.pos.x, entity.pos.y, '+NANO', 'nano');
        burst(state, entity.pos.x, entity.pos.y, 'mark-objective', 10, 40);
        play('pickup');
      }
    }
  }

  // Bullet against entity.
  for (const bullet of state.bullets) {
    if (bullet.life <= 0) continue;
    for (const entity of state.entities) {
      if (entity.dead || entity.kind === 'objective') continue;
      if (dist(bullet.pos, entity.pos) > entity.radius + 1.5) continue;

      if (entity.kind === 'friendly') {
        loseCivilian(state, entity);
        bullet.life = 0;
        break;
      }

      state.stats.shotsHit += 1;
      entity.hp -= bullet.damage;
      entity.hitUntil = state.time + 120;
      burst(state, bullet.pos.x, bullet.pos.y, 'mark-hostile', 3, 30);
      play('hit');

      if (entity.hp <= 0) {
        killHostile(state, entity);
      }

      if (bullet.pierce > 0) {
        bullet.pierce -= 1;
      } else {
        bullet.life = 0;
        break;
      }
    }
  }

  state.entities = state.entities.filter((entity) => !entity.dead);

  // Particles and floaters.
  for (const particle of state.particles) {
    particle.pos.x += particle.vel.x * seconds;
    particle.pos.y += particle.vel.y * seconds;
    particle.vel.x *= 0.92;
    particle.vel.y *= 0.92;
    particle.life -= dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);

  for (const floater of state.floaters) {
    floater.pos.y -= 12 * seconds;
    floater.life -= dt;
  }
  state.floaters = state.floaters.filter((floater) => floater.life > 0);

  // Spawning.
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    const interval = Math.max(320, 1150 - state.wave * 70);
    state.spawnTimer = interval;
    const alive = state.entities.filter((entity) => entity.kind === 'hostile').length;
    if (alive < 4 + state.wave * 2 && state.waveKills + alive < state.waveKillsNeeded) {
      spawnHostile(state);
    }
    const civilians = state.entities.filter((entity) => entity.kind === 'friendly').length;
    if (civilians < 2 && Math.random() < 0.5) spawnFriendly(state);
    const objectives = state.entities.filter((entity) => entity.kind === 'objective').length;
    if (objectives === 0 && Math.random() < 0.4) spawnObjective(state);
  }

  if (state.combo > 0 && state.time > state.comboUntil) state.combo = 0;
  state.shake = Math.max(0, state.shake - dt * 0.02);

  // Wave clear.
  if (state.waveKills >= state.waveKillsNeeded) {
    state.phase = 'intermission';
    state.stats.score += 500 + state.wave * 100;
    state.offeredUpgrades = pickUpgrades(state);
    play('wave');
  }
}

/* --- Upgrades ---------------------------------------------------------------
   The between-wave reward. Three cards, one pick, and the card that is chosen
   uses the 420ms equip transition so the cause of the change stays legible. */

const ALL_UPGRADES: Upgrade[] = [
  {
    id: 'rate',
    name: 'CYCLE TUNING',
    detail: 'Fire 15% faster.',
    apply: (state) => {
      state.player.fireRateMs *= 0.85;
    },
  },
  {
    id: 'damage',
    name: 'PENETRATOR ROUNDS',
    detail: 'Each round deals one more point of damage.',
    apply: (state) => {
      state.player.damage += 1;
    },
  },
  {
    id: 'speed',
    name: 'SERVO ASSIST',
    detail: 'Move 12% faster.',
    apply: (state) => {
      state.player.speed *= 1.12;
    },
  },
  {
    id: 'vitals',
    name: 'TRAUMA WEAVE',
    detail: 'Raise maximum health by 20 and refill it.',
    apply: (state) => {
      state.player.maxHp += 20;
      state.player.hp = state.player.maxHp;
    },
  },
  {
    id: 'nano',
    name: 'NANO RESERVOIR',
    detail: 'Raise maximum nano by 25 and refill it.',
    apply: (state) => {
      state.player.maxNano += 25;
      state.player.nano = state.player.maxNano;
    },
  },
  {
    id: 'overdrive',
    name: 'OVERDRIVE MK II',
    detail: 'Data Overdrive pierces one more target.',
    apply: (state) => {
      state.abilities.overdrive.level += 1;
    },
  },
  {
    id: 'pulse',
    name: 'WIDE-BAND SCAN',
    detail: 'Pulse Scan reaches further.',
    apply: (state) => {
      state.abilities.pulse.level += 1;
    },
  },
];

export function pickUpgrades(state: GameState): Upgrade[] {
  const pool = [...ALL_UPGRADES];
  const picked: Upgrade[] = [];
  while (picked.length < 3 && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  void state;
  return picked;
}

export function nextWave(state: GameState): void {
  state.wave += 1;
  state.stats.wave = state.wave;
  state.waveKills = 0;
  state.waveKillsNeeded = 6 + state.wave * 3;
  state.spawnTimer = 600;
  state.offeredUpgrades = [];
  state.phase = 'playing';
}

export function accuracy(state: GameState): number {
  return state.stats.shotsFired === 0
    ? 0
    : state.stats.shotsHit / state.stats.shotsFired;
}
