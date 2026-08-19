/**
 * Persistence and rewards.
 *
 * Everything is local. There is no account, no server and no telemetry: a
 * portfolio piece that phones home is a liability, and localStorage is enough
 * for a leaderboard someone will actually beat against themselves.
 *
 * Every read is wrapped, because private windows and blocked site data throw
 * on access rather than returning null.
 */

import type { GameState, RunStats } from './types';

const KEY_SCORES = 'mutiny.scores.v1';
const KEY_MEDALS = 'mutiny.medals.v1';
const KEY_SETTINGS = 'mutiny.settings.v1';

export interface ScoreRow {
  initials: string;
  score: number;
  wave: number;
  kills: number;
  accuracy: number;
  at: number;
}

export interface Medal {
  id: string;
  name: string;
  detail: string;
}

export const MEDALS: (Medal & { earned: (state: GameState) => boolean })[] = [
  {
    id: 'first-blood',
    name: 'FIRST CONTACT',
    detail: 'Clear wave one.',
    earned: (state) => state.stats.wave > 1 || state.waveKills >= state.waveKillsNeeded,
  },
  {
    id: 'clean-hands',
    name: 'CLEAN HANDS',
    detail: 'Finish a run without hitting a single friendly.',
    earned: (state) => state.stats.civiliansLost === 0 && state.stats.kills >= 10,
  },
  {
    id: 'chain',
    name: 'CHAIN REACTION',
    detail: 'Reach a combo of twelve.',
    earned: (state) => state.stats.bestCombo >= 12,
  },
  {
    id: 'marksman',
    name: 'MARKSMAN',
    detail: 'Finish above 70% accuracy with at least 40 shots.',
    earned: (state) =>
      state.stats.shotsFired >= 40 && state.stats.shotsHit / state.stats.shotsFired >= 0.7,
  },
  {
    id: 'deep-run',
    name: 'DEEP RUN',
    detail: 'Reach wave five.',
    earned: (state) => state.stats.wave >= 5,
  },
  {
    id: 'collector',
    name: 'DATA COLLECTOR',
    detail: 'Take six objectives in one run.',
    earned: (state) => state.stats.objectivesTaken >= 6,
  },
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable. The run still works, it just is not kept.
  }
}

export function loadScores(): ScoreRow[] {
  return read<ScoreRow[]>(KEY_SCORES, []);
}

export function saveScore(row: ScoreRow): ScoreRow[] {
  const rows = [...loadScores(), row]
    .sort((a, b) => b.score - a.score || b.wave - a.wave || a.at - b.at)
    .slice(0, 10);
  write(KEY_SCORES, rows);
  return rows;
}

export function bestScore(): number {
  return loadScores()[0]?.score ?? 0;
}

export function loadMedals(): string[] {
  return read<string[]>(KEY_MEDALS, []);
}

/** Returns only the medals newly earned by this run, for the summary screen. */
export function awardMedals(state: GameState): Medal[] {
  const already = new Set(loadMedals());
  const fresh = MEDALS.filter((medal) => !already.has(medal.id) && medal.earned(state));
  if (fresh.length > 0) {
    write(KEY_MEDALS, [...already, ...fresh.map((medal) => medal.id)]);
  }
  return fresh.map(({ id, name, detail }) => ({ id, name, detail }));
}

export interface Settings {
  environment: 'night' | 'day';
  muted: boolean;
  reduceEffects: boolean;
}

export const defaultSettings: Settings = {
  environment: 'night',
  muted: false,
  reduceEffects: false,
};

export function loadSettings(): Settings {
  return { ...defaultSettings, ...read<Partial<Settings>>(KEY_SETTINGS, {}) };
}

export function saveSettings(settings: Settings): void {
  write(KEY_SETTINGS, settings);
}

/**
 * Placement, counted rather than looked up.
 *
 * The first version searched the board for a row with a matching score, which
 * returned zero for any run that missed the top ten. The debrief then told a
 * player their score was saved when it had been sliced off. Counting the rows
 * that beat it gives a real placement in every case, ties share a rank, and a
 * run outside the board reads as one past the end.
 */
export function rankOf(rows: ScoreRow[], score: number): number {
  return rows.filter((row) => row.score > score).length + 1;
}

/** Whether a score actually made the board, which is not the same as ranking. */
export function madeBoard(rows: ScoreRow[], row: ScoreRow): boolean {
  return rows.some((entry) => entry.at === row.at && entry.score === row.score);
}

export function summarise(stats: RunStats): string {
  const seconds = Math.max(1, Math.round((stats.endedAt - stats.startedAt) / 1000));
  return `${stats.score.toLocaleString('en-CA')} points, wave ${stats.wave}, ${stats.kills} hostiles down in ${seconds} seconds.`;
}
