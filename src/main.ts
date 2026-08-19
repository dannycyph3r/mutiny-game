/**
 * MUTINY.
 *
 * A lo-fi arena built out of a documented game UI system. The point of the
 * exercise is that the system runs: the HUD is the component set, the timings
 * are the motion table, the colour and shape rules are the ones written down,
 * and the light-environment variant really is a single token change.
 */

import './styles/tokens.css';
import './styles/game.css';

import { attachInput, endFrame, readInput, lastUsedDevice } from './game/input';
import { initAudio, isMuted, play, setMuted } from './game/audio';
import { prefersReducedMotion, refreshPalette } from './game/palette';
import { loadBackdrop, render } from './game/render';
import {
  ABILITY_SPECS,
  WORLD,
  accuracy,
  createState,
  nextWave,
  step,
  tryAbility,
} from './game/world';
import {
  awardMedals,
  bestScore,
  loadScores,
  loadSettings,
  madeBoard,
  rankOf,
  saveScore,
  saveSettings,
  summarise,
  type ScoreRow,
  type Settings,
} from './game/progress';
import type { AbilityId, GameState, Upgrade } from './game/types';

/* --- Element lookups --------------------------------------------------------- */

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
};

const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D is unavailable');

const hud = $('hud');
const announce = $('announce');

const screens = {
  title: $('screen-title'),
  intermission: $('screen-intermission'),
  pause: $('screen-pause'),
  over: $('screen-over'),
  scores: $('screen-scores'),
  settings: $('screen-settings'),
};

/* --- Settings ---------------------------------------------------------------- */

let settings: Settings = loadSettings();
let showSafeZone = false;
let effectsReduced = settings.reduceEffects || prefersReducedMotion();

// Three arenas rotate on the wave counter. The interior appears in both
// environments because it is lit from inside, which is the one backdrop the
// day and night token sets do not change the reading of.
const ARENAS: Record<'night' | 'day', string[]> = {
  night: ['/bg/forest-night.png', '/bg/underpass-night.png', '/bg/cellblock.png'],
  day: ['/bg/forest-day.png', '/bg/underpass-day.png', '/bg/cellblock.png'],
};

function applyEnvironment(): void {
  document.documentElement.setAttribute('data-env', settings.environment);
  // The palette is re-resolved rather than re-authored: the renderer reads the
  // same tokens the HUD does, so both move together.
  refreshPalette();
  const pool = ARENAS[settings.environment];
  loadBackdrop(pool[state ? (state.wave - 1) % pool.length : 0]);
}

function persist(): void {
  settings.reduceEffects = effectsReduced;
  settings.muted = isMuted();
  saveSettings(settings);
}

/* --- Screen plumbing ----------------------------------------------------------- */

type ScreenName = keyof typeof screens | 'none';

function showScreen(name: ScreenName, moveFocus = true): void {
  for (const [key, element] of Object.entries(screens)) {
    element.hidden = key !== name;
  }
  hud.hidden = !(name === 'none' || name === 'pause' || name === 'intermission');

  // Focus moves into whatever just appeared, so a keyboard or pad player is
  // never left on a control that is now behind an overlay. The exception is the
  // first paint: focusing the start button there puts the skip link behind the
  // first tab press, which is the one thing it exists to be in front of.
  if (name !== 'none' && moveFocus) {
    const target = screens[name].querySelector<HTMLElement>(
      'button, [href], input, select',
    );
    window.requestAnimationFrame(() => target?.focus());
  }
}

function say(message: string): void {
  announce.textContent = message;
}

/* --- Game state ---------------------------------------------------------------- */

let state: GameState = createState(settings.environment, ARENAS[settings.environment][0]);
let lastFrame = performance.now();
let comboShownAt = 0;

function startRun(): void {
  initAudio();
  state = createState(settings.environment, ARENAS[settings.environment][0]);
  state.phase = 'playing';
  applyEnvironment();
  showScreen('none');
  syncHud(true);
  say(`Run started. Wave one, clear ${state.waveKillsNeeded} hostiles.`);
  play('wave');
}

function endRun(): void {
  state.phase = 'over';
  state.stats.endedAt = Date.now();
  state.stats.wave = state.wave;
  renderDebrief();
  showScreen('over');
  say(`Run over. ${summarise(state.stats)}`);
}

/* --- HUD ------------------------------------------------------------------------ */

const healthMeter = $('health-meter');
const healthFill = $('health-fill');
const healthValue = $('health-value');
const nanoFill = $('nano-fill');
const nanoValue = $('nano-value');
const missionText = $('mission-text');
const missionProgress = $('mission-progress');
const mission = $('mission');
const scoreValue = $('score-value');
const waveValue = $('wave-value');
const combo = $('combo');
const comboValue = $('combo-value');
const hint = $('hint');

const slotEls: Record<AbilityId, { root: HTMLElement; status: HTMLElement; sweep: HTMLElement; key: HTMLElement }> = {
  overdrive: {
    root: $('slot-1'),
    status: $('slot-1-status'),
    sweep: $('slot-1-sweep'),
    key: $('slot-1-key'),
  },
  pulse: {
    root: $('slot-2'),
    status: $('slot-2-status'),
    sweep: $('slot-2-sweep'),
    key: $('slot-2-key'),
  },
};

let lastWaveSeen = 0;

function syncHud(force = false): void {
  const { player } = state;

  const healthPct = Math.max(0, player.hp / player.maxHp);
  healthFill.style.width = `${healthPct * 100}%`;
  healthValue.textContent = String(Math.ceil(player.hp));
  // Critical is a state, not only a colour: the numerals change too.
  healthMeter.dataset.critical = String(healthPct <= 0.25);

  nanoFill.style.width = `${Math.max(0, player.nano / player.maxNano) * 100}%`;
  nanoValue.textContent = String(Math.floor(player.nano));

  scoreValue.textContent = state.stats.score.toLocaleString('en-CA');
  waveValue.textContent = String(state.wave);
  missionProgress.textContent = `${state.waveKills} / ${state.waveKillsNeeded}`;

  const showCombo = state.combo >= 2;
  combo.hidden = !showCombo;
  if (showCombo) {
    comboValue.textContent = `x${Math.min(8, 1 + Math.floor(state.combo / 3))}`;
    comboShownAt = state.time;
  }
  void comboShownAt;

  if (force || state.wave !== lastWaveSeen) {
    lastWaveSeen = state.wave;
    missionText.textContent =
      state.wave === 1 ? 'Clear the block' : `Hold the line, wave ${state.wave}`;
    mission.dataset.updated = 'true';
    window.setTimeout(() => {
      mission.dataset.updated = 'false';
    }, 4200);
  }

  // Ability slots: ready, activated, cooldown, ready.
  for (const key of ['overdrive', 'pulse'] as AbilityId[]) {
    const ability = state.abilities[key];
    const element = slotEls[key];
    const active = state.time < ability.activeUntil;
    const cooling = !active && state.time < ability.readyAt;
    const affordable = player.nano >= ability.cost;

    let progress = 0;
    let nextState: string;
    if (active) {
      nextState = 'active';
      progress = 1 - (ability.activeUntil - state.time) / ability.activeMs;
    } else if (cooling) {
      nextState = 'cooldown';
      progress = 1 - (ability.readyAt - state.time) / ability.cooldownMs;
    } else {
      nextState = affordable ? 'ready' : 'blocked';
      progress = 0;
    }

    element.root.dataset.state = nextState;
    element.status.textContent = active
      ? 'ACTIVE'
      : cooling
        ? `${Math.ceil((ability.readyAt - state.time) / 100) / 10}s`
        : affordable
          ? 'READY'
          : `NANO ${ability.cost}`;

    // A linear sweep reads as time remaining. Easing would misrepresent it.
    element.sweep.style.transform = `scaleX(${cooling ? 1 - progress : 0})`;
    element.key.textContent = lastUsedDevice() === 'pad' ? (key === 'overdrive' ? 'X' : 'Y') : key === 'overdrive' ? '1' : '2';
  }

  hint.hidden = lastUsedDevice() === 'pad';
}

/* --- Intermission --------------------------------------------------------------- */

const upgradeCards = $('upgrade-cards');
const intermissionHeading = $('intermission-heading');

function renderIntermission(): void {
  intermissionHeading.textContent = `Wave ${state.wave} cleared`;
  upgradeCards.replaceChildren();

  for (const upgrade of state.offeredUpgrades) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.equipped = 'false';

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = upgrade.name;

    const detail = document.createElement('span');
    detail.className = 'card-detail';
    detail.textContent = upgrade.detail;

    card.append(name, detail);
    card.addEventListener('click', () => equip(upgrade, card));
    upgradeCards.append(card);
  }

  showScreen('intermission');
  say(`Wave ${state.wave} cleared. Choose one of three upgrades.`);
}

let equipping = false;

function equip(upgrade: Upgrade, card: HTMLElement): void {
  if (equipping) return;
  equipping = true;
  card.dataset.equipped = 'true';
  play('select');
  upgrade.apply(state);
  say(`${upgrade.name} equipped. ${upgrade.detail}`);

  // The icon travels into the slot over the documented equip duration, so the
  // cause of the change is legible before the next wave starts.
  const wait = prefersReducedMotion() || effectsReduced ? 60 : 420;
  window.setTimeout(() => {
    equipping = false;
    nextWave(state);
    const pool = ARENAS[settings.environment];
    loadBackdrop(pool[(state.wave - 1) % pool.length]);
    showScreen('none');
    syncHud(true);
    say(`Wave ${state.wave}. Clear ${state.waveKillsNeeded} hostiles.`);
    play('wave');
  }, wait);
}

/* --- Pause ------------------------------------------------------------------------ */

const paneMission = $('pane-mission');
const paneAbilities = $('pane-abilities');
const paneMap = $('pane-map');

function renderPause(): void {
  paneMission.replaceChildren(
    definitionList([
      ['Wave', String(state.wave)],
      ['Cleared', `${state.waveKills} of ${state.waveKillsNeeded}`],
      ['Score', state.stats.score.toLocaleString('en-CA')],
      ['Best combo', `x${Math.min(8, 1 + Math.floor(state.stats.bestCombo / 3))}`],
      ['Friendlies lost', String(state.stats.civiliansLost)],
    ]),
  );

  paneAbilities.replaceChildren(
    definitionList(
      (['overdrive', 'pulse'] as AbilityId[]).map((key) => {
        const ability = state.abilities[key];
        return [
          ABILITY_SPECS[key].name,
          `Level ${ability.level}, ${ability.cost} nano, ${ability.activeMs / 1000}s active, ${ability.cooldownMs / 1000}s cooldown`,
        ] as [string, string];
      }),
    ),
  );

  const hostiles = state.entities.filter((entity) => entity.kind === 'hostile').length;
  const friendlies = state.entities.filter((entity) => entity.kind === 'friendly').length;
  paneMap.replaceChildren(
    definitionList([
      ['Arena', settings.environment === 'day' ? 'Urban, day' : 'Urban, night'],
      ['Hostiles active', String(hostiles)],
      ['Friendlies in the area', String(friendlies)],
      ['Objective', state.objectiveTarget ? 'Marked on the field' : 'None active'],
    ]),
  );
}

function definitionList(rows: [string, string][]): HTMLElement {
  const list = document.createElement('dl');
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.append(dt, dd);
  }
  return list;
}

for (const [tabId, paneId] of [
  ['tab-mission', 'pane-mission'],
  ['tab-abilities', 'pane-abilities'],
  ['tab-map', 'pane-map'],
] as const) {
  $(tabId).addEventListener('click', () => {
    for (const [otherTab, otherPane] of [
      ['tab-mission', 'pane-mission'],
      ['tab-abilities', 'pane-abilities'],
      ['tab-map', 'pane-map'],
    ] as const) {
      const selected = otherTab === tabId;
      $(otherTab).setAttribute('aria-selected', String(selected));
      $(otherPane).hidden = !selected;
    }
    void paneId;
    play('select');
  });
}

/* --- Debrief and board -------------------------------------------------------------- */

const debrief = $('debrief');
const medals = $('medals');
const board = $('board');
const initialsForm = $<HTMLFormElement>('initials-form');
const initialsInput = $<HTMLInputElement>('initials-input');
let savedThisRun = false;

function renderDebrief(): void {
  savedThisRun = false;
  const stats = state.stats;
  const rows: [string, string][] = [
    ['SCORE', stats.score.toLocaleString('en-CA')],
    ['WAVE', String(stats.wave)],
    ['HOSTILES', String(stats.kills)],
    ['ACCURACY', `${Math.round(accuracy(state) * 100)}%`],
    ['BEST COMBO', `x${Math.min(8, 1 + Math.floor(stats.bestCombo / 3))}`],
    ['FRIENDLIES LOST', String(stats.civiliansLost)],
  ];

  debrief.replaceChildren(
    ...rows.map(([label, value]) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'stat';
      const l = document.createElement('span');
      l.className = 'stat-label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'stat-value';
      v.textContent = value;
      wrapper.append(l, v);
      return wrapper;
    }),
  );

  const fresh = awardMedals(state);
  medals.replaceChildren(
    ...fresh.map((medal) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'medal';
      const name = document.createElement('span');
      name.className = 'medal-name';
      name.textContent = medal.name;
      const detail = document.createElement('span');
      detail.className = 'medal-detail';
      detail.textContent = medal.detail;
      wrapper.append(name, detail);
      return wrapper;
    }),
  );

  initialsForm.hidden = false;
}

function renderBoard(highlightScore?: number): void {
  const rows = loadScores();
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'board-empty';
    empty.textContent = 'No runs recorded yet. The board fills up as you play.';
    board.replaceChildren(empty);
    return;
  }

  board.replaceChildren(
    ...rows.map((row, index) => {
      const line = document.createElement('div');
      line.className = 'board-row';
      line.dataset.fresh = String(highlightScore === row.score);
      for (const text of [
        String(index + 1),
        row.initials,
        `wave ${row.wave}, ${row.kills} down, ${Math.round(row.accuracy * 100)}%`,
        row.score.toLocaleString('en-CA'),
      ]) {
        const cell = document.createElement('span');
        cell.textContent = text;
        line.append(cell);
      }
      return line;
    }),
  );
}

initialsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (savedThisRun) return;
  savedThisRun = true;

  const row: ScoreRow = {
    initials: (initialsInput.value || 'AAA').toUpperCase().slice(0, 3),
    score: state.stats.score,
    wave: state.stats.wave,
    kills: state.stats.kills,
    accuracy: accuracy(state),
    at: Date.now(),
  };
  const rows = saveScore(row);
  const rank = rankOf(rows, row.score);
  const kept = madeBoard(rows, row);
  initialsForm.hidden = true;
  renderBoard(row.score);
  showScreen('scores');
  say(
    kept
      ? `Score saved at rank ${rank} of ${rows.length}.`
      : `That run placed ${rank}, outside the top ${rows.length}, so it was not kept.`,
  );
  play('pickup');
});

/* --- Buttons -------------------------------------------------------------------------- */

$('btn-start').addEventListener('click', startRun);
$('btn-again').addEventListener('click', startRun);
$('btn-title').addEventListener('click', () => {
  state.phase = 'title';
  refreshBest();
  showScreen('title');
});
$('btn-scores').addEventListener('click', () => {
  renderBoard();
  showScreen('scores');
});
$('btn-scores-back').addEventListener('click', () => {
  showScreen(state.phase === 'over' ? 'over' : 'title');
});
$('btn-settings').addEventListener('click', () => showScreen('settings'));
$('btn-settings-back').addEventListener('click', () => showScreen('title'));
$('btn-resume').addEventListener('click', resume);
$('btn-quit').addEventListener('click', endRun);

slotEls.overdrive.root.addEventListener('click', () => useAbility('overdrive'));
slotEls.pulse.root.addEventListener('click', () => useAbility('pulse'));

const envButton = $('btn-env');
const effectsButton = $('btn-effects');
const soundButton = $('btn-sound');
const safeButton = $('btn-safe');

function syncSettingsUi(): void {
  envButton.textContent = settings.environment === 'day' ? 'Day' : 'Night';
  envButton.setAttribute('aria-pressed', String(settings.environment === 'day'));
  effectsButton.textContent = effectsReduced ? 'On' : 'Off';
  effectsButton.setAttribute('aria-pressed', String(effectsReduced));
  soundButton.textContent = isMuted() ? 'Off' : 'On';
  soundButton.setAttribute('aria-pressed', String(!isMuted()));
  safeButton.textContent = showSafeZone ? 'On' : 'Off';
  safeButton.setAttribute('aria-pressed', String(showSafeZone));
}

envButton.addEventListener('click', () => {
  settings.environment = settings.environment === 'day' ? 'night' : 'day';
  applyEnvironment();
  persist();
  syncSettingsUi();
  say(`${settings.environment === 'day' ? 'Day' : 'Night'} environment. One token change, hue and chroma held.`);
  play('select');
});

effectsButton.addEventListener('click', () => {
  effectsReduced = !effectsReduced;
  persist();
  syncSettingsUi();
  say(effectsReduced ? 'Effects reduced.' : 'Effects on.');
});

soundButton.addEventListener('click', () => {
  initAudio();
  setMuted(!isMuted());
  persist();
  syncSettingsUi();
});

safeButton.addEventListener('click', () => {
  showSafeZone = !showSafeZone;
  syncSettingsUi();
});

/* --- Pause and resume -------------------------------------------------------------------- */

function pause(): void {
  if (state.phase !== 'playing') return;
  state.phase = 'paused';
  renderPause();
  showScreen('pause');
  say('Paused.');
}

function resume(): void {
  if (state.phase !== 'paused') return;
  state.phase = 'playing';
  lastFrame = performance.now();
  showScreen('none');
  say('Resumed.');
}

function useAbility(which: AbilityId): void {
  if (state.phase !== 'playing') return;
  const result = tryAbility(state, which);
  if (result === 'nano') {
    say(`${ABILITY_SPECS[which].name} needs ${ABILITY_SPECS[which].cost} nano.`);
    play('deny');
  } else if (result === 'cooldown') {
    play('deny');
  } else {
    say(`${ABILITY_SPECS[which].name} active.`);
  }
}

/* --- Loop ---------------------------------------------------------------------------------- */

function refreshBest(): void {
  const best = bestScore();
  $('best-line').textContent = best > 0 ? `Best run: ${best.toLocaleString('en-CA')}` : '';
}

let previousPhase: GameState['phase'] = 'title';

function frame(now: number): void {
  // Clamped so a backgrounded tab does not resume with one enormous step that
  // teleports every hostile onto the player.
  const dt = Math.min(50, now - lastFrame);
  lastFrame = now;

  const input = readInput(state.player.pos);

  if (state.phase === 'playing') {
    if (input.pause) pause();
    if (input.ability1) useAbility('overdrive');
    if (input.ability2) useAbility('pulse');

    step(state, dt, { move: input.move, aim: input.aim, fire: input.fire });
    syncHud();
  } else if (state.phase === 'paused' && input.pause) {
    resume();
  } else if (state.phase === 'title' && input.confirm) {
    startRun();
  }

  if (state.phase !== previousPhase) {
    if (state.phase === 'intermission') renderIntermission();
    if (state.phase === 'over') endRun();
    previousPhase = state.phase;
  }

  render(ctx!, state, { reduceEffects: effectsReduced, showSafeZone });
  endFrame();
  window.requestAnimationFrame(frame);
}

/* --- Boot ------------------------------------------------------------------------------------ */

attachInput(canvas, WORLD);
setMuted(settings.muted);
applyEnvironment();
syncSettingsUi();
refreshBest();
showScreen('title', false);
say('MUTINY. Press Enter or the A button to start a run.');

// Re-resolve tokens if the system theme changes underneath us.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyEnvironment);

/**
 * Test seam.
 *
 * The browser audit needs to reach the intermission and the debrief without
 * playing a wave to completion, which would make the run time-dependent and
 * flaky. Rather than reaching into the simulation from outside, the two
 * transitions are exposed through the same state the game itself sets, so a
 * forced wave end is the identical code path a played wave end takes.
 */
(window as unknown as { __mutiny: Record<string, () => void> }).__mutiny = {
  forceWaveEnd: () => {
    if (state.phase !== 'playing') return;
    state.waveKills = state.waveKillsNeeded;
  },
  forceEnd: () => {
    if (state.phase === 'over') return;
    state.player.hp = 0;
    state.phase = 'over';
  },
};

window.requestAnimationFrame((now) => {
  lastFrame = now;
  frame(now);
});
