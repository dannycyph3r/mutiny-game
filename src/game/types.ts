/** Shared types for the Mutiny arena. */

export type EntityKind = 'hostile' | 'friendly' | 'objective';
export type HostileClass = 'walker' | 'runner' | 'brute';

export interface Vec {
  x: number;
  y: number;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  hostileClass?: HostileClass;
  pos: Vec;
  vel: Vec;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  contactDamage: number;
  /** Set while a Pulse Scan is marking this entity. */
  revealedUntil: number;
  /** Set on hit, drives the impact flash. */
  hitUntil: number;
  dead: boolean;
}

export interface Bullet {
  id: number;
  pos: Vec;
  vel: Vec;
  life: number;
  pierce: number;
  damage: number;
}

export interface Particle {
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  /* Arena marks, not chrome roles: particles land on the backdrop, so they
     take the environment-independent mark palette like everything else there. */
  colour: 'mark-hostile' | 'mark-friendly' | 'mark-objective' | 'mark-round' | 'nano';
  size: number;
}

export interface Floater {
  pos: Vec;
  text: string;
  life: number;
  colour: 'mark-round' | 'mark-hostile' | 'mark-friendly' | 'mark-objective' | 'nano';
}

export type AbilityId = 'overdrive' | 'pulse';

export interface AbilityState {
  id: AbilityId;
  name: string;
  description: string;
  /** Nano spent on activation. */
  cost: number;
  /** Milliseconds the effect is live, from the motion table. */
  activeMs: number;
  /** Milliseconds before it is ready again, from the motion table. */
  cooldownMs: number;
  activeUntil: number;
  readyAt: number;
  /** Upgrade level, raised between waves. */
  level: number;
}

export type RunPhase =
  | 'title'
  | 'briefing'
  | 'playing'
  | 'intermission'
  | 'paused'
  | 'over';

export interface Player {
  pos: Vec;
  vel: Vec;
  aim: Vec;
  radius: number;
  hp: number;
  maxHp: number;
  nano: number;
  maxNano: number;
  speed: number;
  fireRateMs: number;
  damage: number;
  lastShotAt: number;
  invulnerableUntil: number;
  hitUntil: number;
}

export interface Upgrade {
  id: string;
  name: string;
  detail: string;
  apply: (state: GameState) => void;
}

export interface RunStats {
  score: number;
  wave: number;
  kills: number;
  civiliansLost: number;
  objectivesTaken: number;
  bestCombo: number;
  shotsFired: number;
  shotsHit: number;
  startedAt: number;
  endedAt: number;
}

export interface GameState {
  phase: RunPhase;
  time: number;
  player: Player;
  entities: Entity[];
  bullets: Bullet[];
  particles: Particle[];
  floaters: Floater[];
  abilities: Record<AbilityId, AbilityState>;
  wave: number;
  waveKillsNeeded: number;
  waveKills: number;
  spawnTimer: number;
  combo: number;
  comboUntil: number;
  stats: RunStats;
  shake: number;
  /** Frames of hit-stop remaining. */
  freeze: number;
  offeredUpgrades: Upgrade[];
  objectiveTarget: Vec | null;
  environment: 'night' | 'day';
  arena: string;
}
