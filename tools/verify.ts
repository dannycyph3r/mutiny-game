/* Cloud verification of the Mutiny simulation. Run: bun verify-mutiny.ts
   The game has no framework to lean on, so the rules are asserted directly:
   the documented timings, the shape-language penalty, the wave curve, the
   scoring ladder, and the invariants that keep a run from contradicting the HUD. */

// The audio module reaches for WebAudio at call time, so it is stubbed before
// the world is imported. Nothing in the simulation depends on sound.
(globalThis as any).window = (globalThis as any).window ?? {};
(globalThis as any).AudioContext = class {
  state = 'running';
  destination = {};
  currentTime = 0;
  resume() {}
  createOscillator() {
    return { type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
  }
};
(globalThis as any).localStorage = (() => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
})();

const {
  ABILITY_SPECS, SAFE, WORLD,
  accuracy, createState, nextWave, pickUpgrades, spawnFriendly,
  spawnHostile, spawnObjective, step, tryAbility,
} = await import('../src/game/world');
const {
  MEDALS, awardMedals, bestScore, defaultSettings, loadScores,
  loadSettings, madeBoard, rankOf, saveScore, saveSettings, summarise,
} = await import('../src/game/progress');

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean) => (cond ? pass++ : fails.push(name));
const eq = (name: string, a: unknown, b: unknown) =>
  ok(`${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`,
     JSON.stringify(a) === JSON.stringify(b));

const idle = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: false };
/** Advance the sim in 16ms slices so nothing tunnels through a collision. */
const run = (state: any, ms: number, input = idle) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) step(state, 16, input);
};
const fresh = () => {
  const state = createState('night', '/bg/street-night.png');
  state.phase = 'playing';
  return state;
};

// --- the world matches the documented layout --------------------------------
eq('world is a quarter of the 1920x1080 target', [WORLD.w * 4, WORLD.h * 4], [1920, 1080]);
eq('the safe inset is 5 percent', [SAFE.x / WORLD.w, SAFE.y / WORLD.h], [0.05, 0.05]);

// --- the documented motion table drives the abilities -----------------------
for (const id of ['overdrive', 'pulse'] as const) {
  eq(`${id} active window is the documented 1400ms`, ABILITY_SPECS[id].activeMs, 1400);
  eq(`${id} cooldown is the documented 2800ms`, ABILITY_SPECS[id].cooldownMs, 2800);
}

let s = fresh();
eq('abilities start ready', [s.abilities.overdrive.readyAt, s.abilities.pulse.readyAt], [0, 0]);
eq('a full-nano player can fire an ability', tryAbility(s, 'overdrive'), 'used');
eq('the active window ends 1400ms out', s.abilities.overdrive.activeUntil - s.time, 1400);
eq('cooldown runs from the end of the window, not the start',
   s.abilities.overdrive.readyAt - s.abilities.overdrive.activeUntil, 2800);
eq('an ability on cooldown is refused', tryAbility(s, 'overdrive'), 'cooldown');
s.player.nano = 0;
eq('an ability with no nano is refused for nano, not cooldown', tryAbility(s, 'pulse'), 'nano');
ok('a refused ability costs nothing', s.player.nano === 0);

s = fresh();
tryAbility(s, 'overdrive');
const spentNano = s.player.maxNano - s.player.nano;
eq('overdrive costs its stated price', spentNano, ABILITY_SPECS.overdrive.cost);
run(s, 1400 + 2800 + 32);
ok('the ability returns to ready after window plus cooldown', s.time >= s.abilities.overdrive.readyAt);
eq('a cycled ability can fire again', tryAbility(s, 'overdrive'), 'used');

// pulse reveals only hostiles in range, and only for the active window
s = fresh();
s.player.pos = { x: 240, y: 135 };
spawnHostile(s);
s.entities[0].pos = { x: 250, y: 135 };
spawnHostile(s);
s.entities[1].pos = { x: 470, y: 260 };
tryAbility(s, 'pulse');
ok('pulse reveals a hostile inside its range', s.entities[0].revealedUntil > s.time);
eq('pulse leaves a distant hostile unrevealed', s.entities[1].revealedUntil, 0);
eq('the reveal expires with the active window',
   s.entities[0].revealedUntil, s.abilities.pulse.activeUntil);

// --- firing ------------------------------------------------------------------
s = fresh();
const firing = { move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fire: true };
step(s, 16, firing);
eq('one shot per press-frame', s.bullets.length, 1);
step(s, 16, firing);
eq('the fire rate gates the next shot', s.bullets.length, 1);
run(s, 200, firing);
ok('the shot lands once the rate has elapsed', s.bullets.length >= 2);
eq('every bullet is counted as a shot fired', s.stats.shotsFired, s.bullets.length);

s = fresh();
tryAbility(s, 'overdrive');
run(s, 340, firing);
const boosted = s.stats.shotsFired;
s = fresh();
run(s, 340, firing);
ok(`overdrive doubles the fire rate (${boosted} boosted vs ${s.stats.shotsFired} base)`,
   boosted > s.stats.shotsFired);

// --- the shape language is a mechanic ---------------------------------------
s = fresh();
s.player.pos = { x: 100, y: 135 };
spawnHostile(s);
s.entities[0].pos = { x: 160, y: 135 };
s.entities[0].hp = 1;
run(s, 400, firing);
ok('a hostile in the line of fire dies', s.stats.kills === 1);
ok('a kill scores', s.stats.score > 0);
eq('a kill opens a combo', s.combo, 1);
eq('a hit is counted', s.stats.shotsHit >= 1, true);

s = fresh();
s.stats.score = 1000;
s.combo = 5;
s.comboUntil = 9e9;
s.player.pos = { x: 100, y: 135 };
spawnFriendly(s);
s.entities[0].pos = { x: 160, y: 135 };
run(s, 400, firing);
eq('shooting a circle costs 250 points', s.stats.score, 750);
eq('shooting a circle breaks the combo', s.combo, 0);
eq('the loss is recorded for the debrief', s.stats.civiliansLost, 1);
s.stats.score = 100;
s.combo = 0;
spawnFriendly(s);
s.entities[s.entities.length - 1].pos = { x: 170, y: 135 };
run(s, 500, firing);
ok('the penalty never drives the score below zero', s.stats.score >= 0);

// --- combos ------------------------------------------------------------------
s = fresh();
const scoreOneKill = () => {
  s.player.pos = { x: 100, y: 135 };
  spawnHostile(s);
  const hostile = s.entities[s.entities.length - 1];
  hostile.pos = { x: 150, y: 135 };
  hostile.hp = 1;
  const before = s.stats.score;
  run(s, 400, firing);
  return s.stats.score - before;
};
const first = scoreOneKill();
for (let i = 0; i < 5; i += 1) scoreOneKill();
const later = scoreOneKill();
ok(`a longer chain is worth more per kill (${first} then ${later})`, later > first);
ok('the best combo is remembered', s.stats.bestCombo >= 6);
run(s, 3200);
eq('the combo lapses after its window', s.time > s.comboUntil, true);

// --- damage and the run ending ----------------------------------------------
s = fresh();
s.player.pos = { x: 240, y: 135 };
spawnHostile(s);
s.entities[0].pos = { x: 242, y: 135 };
run(s, 64);
ok('a hostile in contact hurts the player', s.player.hp < 100);
const afterFirstHit = s.player.hp;
run(s, 300);
eq('invulnerability holds for the documented window', s.player.hp, afterFirstHit);
eq('taking a hit breaks the combo', s.combo, 0);

s = fresh();
s.player.hp = 1;
s.player.pos = { x: 240, y: 135 };
spawnHostile(s);
s.entities[0].pos = { x: 242, y: 135 };
run(s, 64);
eq('the run ends at zero health', s.phase, 'over');
eq('health never reads negative', s.player.hp, 0);
const frozen = { ...s.stats };
run(s, 500, firing);
eq('a finished run stops simulating', s.stats, frozen);

// --- spawning stays inside the arena ----------------------------------------
s = fresh();
for (let i = 0; i < 60; i += 1) spawnHostile(s);
ok('hostiles spawn on the edge of the world', s.entities.every((e: any) =>
  e.pos.x >= -20 && e.pos.x <= WORLD.w + 20 && e.pos.y >= -20 && e.pos.y <= WORLD.h + 20));
s = fresh();
for (let i = 0; i < 60; i += 1) spawnFriendly(s);
ok('friendlies spawn inside the title-safe area', s.entities.every((e: any) =>
  e.pos.x >= SAFE.x && e.pos.x <= WORLD.w - SAFE.x &&
  e.pos.y >= SAFE.y && e.pos.y <= WORLD.h - SAFE.y));
s = fresh();
spawnObjective(s);
eq('an objective sets the navigation target', s.objectiveTarget, s.entities[0].pos);

// --- the player is bounded ---------------------------------------------------
s = fresh();
run(s, 4000, { move: { x: -1, y: -1 }, aim: { x: 1, y: 0 }, fire: false });
ok('the player cannot leave the world', s.player.pos.x >= s.player.radius && s.player.pos.y >= s.player.radius);
run(s, 8000, { move: { x: 1, y: 1 }, aim: { x: 1, y: 0 }, fire: false });
ok('nor the far edge', s.player.pos.x <= WORLD.w - s.player.radius && s.player.pos.y <= WORLD.h - s.player.radius);

// --- waves -------------------------------------------------------------------
s = fresh();
const firstQuota = s.waveKillsNeeded;
nextWave(s);
eq('the wave counter advances', s.wave, 2);
ok('each wave asks for more', s.waveKillsNeeded > firstQuota);
eq('wave progress resets', s.waveKills, 0);
eq('the wave returns to play', s.phase, 'playing');
eq('the stats follow the wave', s.stats.wave, s.wave);

const offers = pickUpgrades(s);
eq('three upgrades are offered', offers.length, 3);
eq('the three offers are distinct', new Set(offers.map((u: any) => u.id)).size, 3);
for (let i = 0; i < 40; i += 1) {
  const set = pickUpgrades(s);
  ok('every offer is always distinct', new Set(set.map((u: any) => u.id)).size === set.length);
}
s = fresh();
const before = { ...s.player };
offers[0].apply(s);
ok('an upgrade changes something', JSON.stringify(s.player) !== JSON.stringify(before) ||
   s.abilities.overdrive.level > 0 || s.abilities.pulse.level > 0);

// --- accuracy ----------------------------------------------------------------
s = fresh();
eq('accuracy with no shots is zero, not NaN', accuracy(s), 0);
s.stats.shotsFired = 10;
s.stats.shotsHit = 4;
eq('accuracy is hits over shots', accuracy(s), 0.4);

// --- nano regenerates but is bounded ----------------------------------------
s = fresh();
s.player.nano = 0;
run(s, 2000);
ok('nano regenerates', s.player.nano > 0);
// Held open deliberately: a normal run ends long before the meter refills, so
// the cap is asserted on a player the arena cannot finish.
s.player.hp = 1e9;
s.player.maxHp = 1e9;
run(s, 60000);
eq('the run under test is still live', s.phase, 'playing');
eq('nano is capped at its maximum', s.player.nano, s.player.maxNano);

// --- progress ----------------------------------------------------------------
eq('an empty board reads empty', loadScores().length, 0);
eq('no scores means no best', bestScore(), 0);
saveScore({ score: 500, wave: 2, kills: 10, accuracy: 0.5, at: 1 });
const board = saveScore({ score: 1500, wave: 4, kills: 30, accuracy: 0.7, at: 2 });
eq('the board is ordered best first', board.map((r: any) => r.score), [1500, 500]);
eq('the best score is the top of the board', bestScore(), 1500);
for (let i = 0; i < 20; i += 1) saveScore({ score: i, wave: 1, kills: 1, accuracy: 0.1, at: i });
ok('the board is capped rather than growing forever', loadScores().length <= 10);
eq('a new best ranks first', rankOf(loadScores(), 99999), 1);
eq('a score below the board ranks one past the end', rankOf(loadScores(), -1), loadScores().length + 1);
const tied = loadScores()[0].score;
eq('tied scores share a rank', rankOf(loadScores(), tied), 1);
const keptRow = { score: 999999, wave: 9, kills: 90, accuracy: 0.9, at: 424242 };
ok('a score that makes the board is reported as kept', madeBoard(saveScore(keptRow), keptRow));
const droppedRow = { score: -5, wave: 1, kills: 0, accuracy: 0, at: 424243 };
ok('a score sliced off the board is not reported as kept',
   !madeBoard(saveScore(droppedRow), droppedRow));

eq('six medals are defined', MEDALS.length, 6);
eq('medal ids are unique', new Set(MEDALS.map((m: any) => m.id)).size, MEDALS.length);
s = fresh();
eq('a run that did nothing earns nothing', awardMedals(s).length, 0);
s.stats.civiliansLost = 0;
s.stats.kills = 100;
s.stats.bestCombo = 20;
s.stats.score = 50000;
s.stats.wave = 10;
s.wave = 10;
s.stats.shotsFired = 100;
s.stats.shotsHit = 95;
const earned = awardMedals(s);
ok('a strong run earns medals', earned.length > 0);
eq('medals are not awarded twice', awardMedals(s).length, 0);

const settings = loadSettings();
eq('settings default to the shipped values', settings, defaultSettings);
saveSettings({ ...defaultSettings, environment: 'day', reduceEffects: true });
eq('settings round-trip', loadSettings().environment, 'day');
ok('a run summary names the wave and score', /wave/i.test(summarise(s.stats)));

// --- determinism of the pure parts ------------------------------------------
const a = fresh();
const b = fresh();
const scripted = { move: { x: 1, y: 0.5 }, aim: { x: 0, y: 1 }, fire: false };
run(a, 1600, scripted);
run(b, 1600, scripted);
eq('identical input with no spawns gives an identical player',
   [a.player.pos, a.player.nano], [b.player.pos, b.player.nano]);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  fails.forEach((f) => console.log(' x', f));
  process.exit(1);
}
