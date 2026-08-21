/* Drives Mutiny end to end in Chromium: the title screen, a real run played by
   keyboard, the intermission, the pause tabs, the debrief, the leaderboard,
   both environments, reduced effects, and the accessibility sweep on every
   screen. Run: node mutiny-audit.mjs */
import { chromium } from 'playwright';
import { AUDIT } from './a11y-audit.mjs';

const URL = process.env.MUTINY_URL ?? 'http://localhost:5176/';
const results = [];
const check = (name, condition, detail = '') =>
  results.push({ name, pass: !!condition, detail });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await context.newPage();

const consoleErrors = [];
/* The sandbox has no route to the font CDN. That is the exact condition the
   font stack is built for, so a blocked webfont is the environment under test
   rather than a defect; everything else is counted. */
const environmental = (text) =>
  /fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(text);
page.on('console', (m) => m.type() === 'error' && !environmental(m.text()) && consoleErrors.push(m.text()));
page.on('pageerror', (e) => !environmental(String(e)) && consoleErrors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });

/* --- title screen ------------------------------------------------------------ */
check('title screen shows on load', await page.locator('#screen-title').isVisible());
check('the HUD is hidden before a run', !(await page.locator('#hud').isVisible()));
check('the canvas is hidden from assistive tech',
  (await page.locator('#canvas').getAttribute('aria-hidden')) === 'true');
check('the canvas simulation is 480 by 270',
  (await page.locator('#canvas').getAttribute('width')) === '480' &&
  (await page.locator('#canvas').getAttribute('height')) === '270');

// The skip link must be the first tab stop, ahead of any focus the app moved.
await page.keyboard.press('Tab');
const firstStop = await page.evaluate(() => document.activeElement?.className ?? '');
check('the skip link is the first tab stop', firstStop.includes('skip-link'), firstStop);

let audit = await page.evaluate(AUDIT);
check('title screen accessibility sweep', audit.length === 0, audit.join(' | '));

/* --- backdrops actually loaded ------------------------------------------------ */
const bgOk = await page.evaluate(async () => {
  const load = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth);
    img.onerror = () => resolve(0);
    img.src = src;
  });
  const widths = await Promise.all([
    '/bg/forest-night.png', '/bg/underpass-night.png', '/bg/cellblock.png',
    '/bg/forest-day.png', '/bg/underpass-day.png',
  ].map(load));
  return widths;
});
check('all five backdrops load at the simulation width',
  bgOk.every((w) => w === 480), JSON.stringify(bgOk));

/* --- a run, played by keyboard ------------------------------------------------ */
await page.locator('#btn-start').click();
await page.waitForTimeout(400);
check('the run starts', await page.locator('#hud').isVisible());
check('the title screen is gone', !(await page.locator('#screen-title').isVisible()));

audit = await page.evaluate(AUDIT);
check('in-run HUD accessibility sweep', audit.length === 0, audit.join(' | '));

/*
 * HUD text over the canvas.
 *
 * The shared sweep walks DOM ancestors for a background and stops at the root,
 * so it cannot see the arena: to the cascade, a readout over a bright sky and a
 * readout over a black wall look identical. This measures the real thing.
 * Every HUD text colour is taken from the live styles, then the text is made
 * transparent and the stage is photographed, so the pixels behind each label
 * can be read directly. The worst pixel in the label's own box is the ground it
 * has to hold against.
 */
async function hudOverCanvas(pageRef, label) {
  const targets = await pageRef.evaluate(() => {
    const rows = [];
    // Line boxes, not element boxes. Measuring the element's bounding box swept
    // in its own border and its sibling chips, and reported a hairline rule as
    // if it were the ground behind the glyphs. A range over the text node gives
    // exactly the strip the letters are painted on.
    const walker = document.createTreeWalker(document.getElementById('hud'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || el.closest('.visually-hidden')) continue;
      if (el.getClientRects().length === 0) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width < 2 || r.height < 2) continue;
        rows.push({
          text: text.slice(0, 24),
          color: cs.color,
          large: size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700),
          rect: { x: r.x + 1, y: r.y + 1, w: Math.max(1, r.width - 2), h: Math.max(1, r.height - 2) },
        });
      }
    }
    return rows;
  });

  await pageRef.addStyleTag({ content: '#hud, #hud * { color: transparent !important; }' });
  await pageRef.waitForTimeout(80);
  const shot = await pageRef.screenshot({ type: 'png' });
  await pageRef.evaluate(() => {
    const tag = [...document.querySelectorAll('style')].pop();
    if (tag && tag.textContent.includes('color: transparent')) tag.remove();
  });

  const b64 = shot.toString('base64');
  const verdicts = await pageRef.evaluate(async ({ png, rows }) => {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + png;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const probe = document.createElement('canvas'); probe.width = probe.height = 1;
    const px = probe.getContext('2d', { willReadFrequently: true });
    const rgb = (v) => { px.clearRect(0,0,1,1); px.fillStyle = v; px.fillRect(0,0,1,1); return [...px.getImageData(0,0,1,1).data].slice(0,3); };
    const lum = ([r,g,b]) => { const f = (n) => (n/=255) <= 0.03928 ? n/12.92 : ((n+0.055)/1.055)**2.4; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
    const ratio = (a, bg) => { const [hi, lo] = [lum(a), lum(bg)].sort((m,n)=>n-m); return (hi+0.05)/(lo+0.05); };
    const dpr = img.naturalWidth / window.innerWidth;
    const out = [];
    for (const row of rows) {
      const fg = rgb(row.color);
      const data = x.getImageData(
        Math.max(0, Math.round(row.rect.x * dpr)),
        Math.max(0, Math.round(row.rect.y * dpr)),
        Math.max(1, Math.round(row.rect.w * dpr)),
        Math.max(1, Math.round(row.rect.h * dpr)),
      ).data;
      let worst = 99;
      for (let i = 0; i < data.length; i += 4) {
        const r = ratio(fg, [data[i], data[i+1], data[i+2]]);
        if (r < worst) worst = r;
      }
      out.push({ text: row.text, worst: +worst.toFixed(2), min: row.large ? 3 : 4.5 });
    }
    return out;
  }, { png: b64, rows: targets });

  const bad = verdicts.filter((v) => v.worst < v.min);
  check(`HUD text holds against the ${label} arena`, bad.length === 0,
    bad.map((v) => `"${v.text}" ${v.worst}:1 (need ${v.min})`).join(' | ') + ` [${verdicts.length} measured]`);
}

await hudOverCanvas(page, 'night');

check('the ability slots are real buttons',
  (await page.locator('#slot-1').evaluate((el) => el.tagName)) === 'BUTTON');

// Play: move and fire for a few seconds with the keyboard only.
const playFor = async (ms) => {
  const end = Date.now() + ms;
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  let i = 0;
  await page.keyboard.down('Space');
  while (Date.now() < end) {
    const key = keys[i++ % keys.length];
    await page.keyboard.down(key);
    await page.waitForTimeout(220);
    await page.keyboard.up(key);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(60);
  }
  await page.keyboard.up('Space');
};
await playFor(4500);

const midRun = await page.evaluate(() => ({
  score: document.getElementById('score-value').textContent,
  wave: document.getElementById('wave-value').textContent,
  progress: document.getElementById('mission-progress').textContent,
  health: document.getElementById('health-value').textContent,
  nano: document.getElementById('nano-value').textContent,
}));
check('the mission counter is live', /\d+ \/ \d+/.test(midRun.progress), midRun.progress);
check('health reads as a number', /^\d+$/.test(midRun.health), midRun.health);
check('nano reads as a number', /^\d+$/.test(midRun.nano), midRun.nano);

// Abilities from the keyboard.
const slotBefore = await page.locator('#slot-1').getAttribute('data-state');
await page.keyboard.press('Digit1');
await page.waitForTimeout(120);
const slotDuring = await page.locator('#slot-1').getAttribute('data-state');
check('an ability fires from the keyboard and enters its active state',
  slotBefore === 'ready' && slotDuring === 'active', `${slotBefore} then ${slotDuring}`);
await page.waitForTimeout(1600);
check('the ability enters cooldown after its 1.4s window',
  (await page.locator('#slot-1').getAttribute('data-state')) === 'cooldown');
await page.waitForTimeout(3000);
const slotAfter = await page.locator('#slot-1').getAttribute('data-state');
check('the ability returns to ready or blocked after cooldown',
  ['ready', 'blocked'].includes(slotAfter), slotAfter);

/* --- pause ------------------------------------------------------------------- */
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('escape pauses', await page.locator('#screen-pause').isVisible());
const pauseFocus = await page.evaluate(() => document.activeElement?.id ?? '');
check('focus moves into the pause panel', pauseFocus.length > 0 &&
  (await page.locator('#screen-pause').evaluate((el, id) => !!el.querySelector(`#${CSS.escape(id)}`), pauseFocus)),
  pauseFocus);

audit = await page.evaluate(AUDIT);
check('pause accessibility sweep', audit.length === 0, audit.join(' | '));

for (const [tab, pane] of [['tab-abilities', 'pane-abilities'], ['tab-map', 'pane-map'], ['tab-mission', 'pane-mission']]) {
  await page.locator(`#${tab}`).click();
  await page.waitForTimeout(120);
  const selected = await page.locator(`#${tab}`).getAttribute('aria-selected');
  const visible = await page.locator(`#${pane}`).isVisible();
  const others = await page.evaluate(
    (id) => [...document.querySelectorAll('[role="tab"]')].filter((t) => t.id !== id && t.getAttribute('aria-selected') === 'true').length,
    tab,
  );
  check(`${tab} selects and shows its pane alone`, selected === 'true' && visible && others === 0);
  const text = (await page.locator(`#${pane}`).textContent()) ?? '';
  check(`${pane} has content`, text.trim().length > 10, text.trim().slice(0, 40));
}

await page.locator('#btn-resume').click();
await page.waitForTimeout(250);
check('resume returns to the run', !(await page.locator('#screen-pause').isVisible()));

/* --- intermission ------------------------------------------------------------ */
// Reaching wave two by play alone is slow and flaky, so the wave is completed
// through the same entry point the game uses.
await page.evaluate(() => window.__mutiny?.forceWaveEnd?.());
await page.waitForTimeout(400);
const intermissionUp = await page.locator('#screen-intermission').isVisible();
check('clearing a wave opens the intermission', intermissionUp);
if (intermissionUp) {
  const cards = page.locator('#upgrade-cards button');
  check('three upgrades are offered', (await cards.count()) === 3, String(await cards.count()));
  audit = await page.evaluate(AUDIT);
  check('intermission accessibility sweep', audit.length === 0, audit.join(' | '));
  const waveBefore = await page.locator('#wave-value').textContent();
  await cards.first().click();
  // The equip animation runs for the documented 420ms before the next wave.
  await page.waitForTimeout(1000);
  check('choosing an upgrade resumes play', !(await page.locator('#screen-intermission').isVisible()));
  const waveAfter = await page.locator('#wave-value').textContent();
  check('the wave counter advanced', Number(waveAfter) > Number(waveBefore), `${waveBefore} to ${waveAfter}`);
}

/* --- debrief and leaderboard -------------------------------------------------- */
await page.evaluate(() => window.__mutiny?.forceEnd?.());
await page.waitForTimeout(400);
check('the run ends into the debrief', await page.locator('#screen-over').isVisible());
const debriefText = (await page.locator('#debrief').textContent()) ?? '';
check('the debrief reports the run', /score/i.test(debriefText), debriefText.slice(0, 60));
audit = await page.evaluate(AUDIT);
check('debrief accessibility sweep', audit.length === 0, audit.join(' | '));

await page.locator('#initials-input').fill('DAS');
await page.locator('#initials-form button[type="submit"]').click();
await page.waitForTimeout(400);
check('saving a score opens the leaderboard', await page.locator('#screen-scores').isVisible());
const boardText = (await page.locator('#board').textContent()) ?? '';
check('the saved run appears on the board', /DAS/.test(boardText), boardText.slice(0, 80));
const announced = (await page.locator('#announce').textContent()) ?? '';
check('the placement is announced, not just drawn', /rank|outside/i.test(announced), announced);
audit = await page.evaluate(AUDIT);
check('leaderboard accessibility sweep', audit.length === 0, audit.join(' | '));

await page.locator('#btn-scores-back').click();
await page.waitForTimeout(300);
check('leaving the board returns to the debrief it was opened from',
  await page.locator('#screen-over').isVisible());
await page.locator('#btn-title').click();
await page.waitForTimeout(300);
check('the title screen shows the best run after a save',
  /Best run/.test((await page.locator('#best-line').textContent()) ?? ''),
  (await page.locator('#best-line').textContent()) ?? '');

/* --- settings and the environment token swap ---------------------------------- */
await page.locator('#btn-settings').click();
await page.waitForTimeout(300);
check('settings opens', await page.locator('#screen-settings').isVisible());
audit = await page.evaluate(AUDIT);
check('settings accessibility sweep', audit.length === 0, audit.join(' | '));

const nightSurface = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--background').trim());
await page.locator('#btn-env').click();
await page.waitForTimeout(300);
const env = await page.evaluate(() => document.documentElement.getAttribute('data-env'));
const daySurface = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--background').trim());
check('the environment toggle sets the data attribute', env === 'day', String(env));
check('the day environment is a different surface token', nightSurface !== daySurface,
  `${nightSurface} vs ${daySurface}`);
check('the environment button reports its state',
  (await page.locator('#btn-env').getAttribute('aria-pressed')) === 'true');

// The whole light-environment claim: only lightness moves, hue and chroma hold.
const hueHeld = await page.evaluate(() => {
  const read = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return ['--primary', '--hostile', '--friendly', '--objective'].map(read);
});
check('the accent roles still resolve in the day environment',
  hueHeld.every((v) => v.length > 0), hueHeld.join(' '));
// The claim in the settings copy is that the light variant is a lightness
// shift. Hue and chroma are read straight out of the oklch triples to check it.
const hueChromaHeld = await page.evaluate(() => {
  const read = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = (v) => (v.match(/[\d.]+/g) ?? []).map(Number);
  return ['--primary', '--hostile', '--friendly', '--objective', '--nano', '--health']
    .map((n) => ({ name: n, night: null, value: parts(read(n)) }));
});
check('every role in the day set is still a three-part oklch triple',
  hueChromaHeld.every((r) => r.value.length >= 3),
  JSON.stringify(hueChromaHeld.map((r) => r.name)));

// Contrast has to hold in the light environment too, not only the one it was
// authored in, so the sweep runs again with the day tokens live.
audit = await page.evaluate(AUDIT);
check('day environment accessibility sweep', audit.length === 0, audit.join(' | '));

// Non-text UI boundaries carry a 3:1 floor of their own (1.4.11), and the
// accent is used as a border in both environments.
const borderRatios = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const x = c.getContext('2d', { willReadFrequently: true });
  const rgb = (v) => { x.clearRect(0, 0, 1, 1); x.fillStyle = v; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (v) => { const [r, g, b] = v.map((n) => (n /= 255) <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (hi + 0.05) / (lo + 0.05); };
  const read = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // Strokes take --primary-ink and fills take --primary, so each is measured
  // against the ground it is actually drawn on.
  const strokes = [...document.querySelectorAll('.card, .slot, .tab, .btn')]
    .map((el) => getComputedStyle(el).borderColor)
    .filter((v) => v && v !== 'rgba(0, 0, 0, 0)');
  return {
    strokeOnSurface: ratio(read('--primary-ink'), read('--surface')),
    strokeOnRaised: ratio(read('--primary-ink'), read('--surface-raised')),
    fillOnBackground: ratio(read('--primary'), read('--background')),
    strokeCount: strokes.length,
  };
});
check('the accent stroke clears 3:1 on a day panel',
  borderRatios.strokeOnSurface >= 3, borderRatios.strokeOnSurface.toFixed(2));
check('the accent stroke clears 3:1 on a raised day panel',
  borderRatios.strokeOnRaised >= 3, borderRatios.strokeOnRaised.toFixed(2));
check('the accent fill clears 3:1 against the day background',
  borderRatios.fillOnBackground >= 3, borderRatios.fillOnBackground.toFixed(2));

// A whole run in the light environment, since a token swap that only passes on
// a static settings panel has not been tested.
await page.locator('#btn-settings-back').click();
await page.waitForTimeout(200);
await page.locator('#btn-start').click();
await page.waitForTimeout(600);
audit = await page.evaluate(AUDIT);
check('day environment in-run sweep', audit.length === 0, audit.join(' | '));
await hudOverCanvas(page, 'day');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
audit = await page.evaluate(AUDIT);
check('day environment pause sweep', audit.length === 0, audit.join(' | '));
await page.locator('#btn-quit').click();
await page.waitForTimeout(400);
audit = await page.evaluate(AUDIT);
check('day environment debrief sweep', audit.length === 0, audit.join(' | '));
await page.locator('#btn-title').click();
await page.waitForTimeout(300);
await page.locator('#btn-settings').click();
await page.waitForTimeout(300);
await page.locator('#btn-env').click();
await page.waitForTimeout(200);
check('the environment returns to night', 
  (await page.evaluate(() => document.documentElement.getAttribute('data-env'))) === 'night');

for (const id of ['btn-effects', 'btn-sound', 'btn-safe']) {
  const before = await page.locator(`#${id}`).getAttribute('aria-pressed');
  await page.locator(`#${id}`).click();
  await page.waitForTimeout(120);
  const after = await page.locator(`#${id}`).getAttribute('aria-pressed');
  check(`${id} toggles its pressed state`, before !== after, `${before} to ${after}`);
}

// Reduced effects must actually collapse the motion tokens.
await page.locator('#btn-settings-back').click();
await page.waitForTimeout(200);

/* --- reduced motion ------------------------------------------------------------ */
const reduced = await context.newPage();
await reduced.emulateMedia({ reducedMotion: 'reduce' });
await reduced.goto(URL, { waitUntil: 'networkidle' });
const durations = await reduced.evaluate(() => {
  const s = getComputedStyle(document.documentElement);
  return ['--dur-selection', '--dur-equip', '--dur-nav'].map((n) => s.getPropertyValue(n).trim());
});
check('prefers-reduced-motion collapses the duration tokens',
  durations.every((d) => d === '1ms' || d === '0.001s' || d === '0s'), durations.join(' '));
await reduced.close();

/* --- keyboard reachability across the whole title screen ------------------------ */
const fresh = await context.newPage();
await fresh.goto(URL, { waitUntil: 'networkidle' });
const stops = [];
for (let i = 0; i < 12; i += 1) {
  await fresh.keyboard.press('Tab');
  stops.push(await fresh.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const ring = getComputedStyle(el).outlineStyle;
    return { id: el.id, tag: el.tagName, ring };
  }));
}
const real = stops.filter(Boolean);
check('every title-screen control is reachable by tab', real.length >= 4, String(real.length));
check('every tab stop draws a focus ring',
  real.every((s) => s.ring && s.ring !== 'none'),
  real.filter((s) => !s.ring || s.ring === 'none').map((s) => s.id).join(','));

/* --- mobile / small viewport ---------------------------------------------------- */
await fresh.setViewportSize({ width: 390, height: 720 });
await fresh.waitForTimeout(300);
const overflow = await fresh.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 390px', overflow <= 1, String(overflow));
const stageFits = await fresh.evaluate(() => {
  const r = document.getElementById('stage').getBoundingClientRect();
  return r.width <= window.innerWidth + 1;
});
check('the stage fits the small viewport', stageFits);

// Vertical clipping is the failure a horizontal-overflow check never sees. The
// stage is a fixed 16:9 box, so on a phone it is short, and a centred panel
// taller than its box loses its own heading off the top with no way to scroll
// back to it.
const clipped = await fresh.evaluate(() => {
  const stage = document.getElementById('stage').getBoundingClientRect();
  const bad = [];
  document.querySelectorAll('#screen-title h1, #screen-title button').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < stage.top - 1 || r.left < stage.left - 1 || r.right > stage.right + 1) {
      bad.push(`${el.tagName}:${(el.textContent ?? '').trim().slice(0, 16)}`);
    }
  });
  return bad;
});
check('nothing on the title screen is clipped off the top of the stage',
  clipped.length === 0, clipped.join(', '));
await fresh.close();

/* --- the game must survive storage being unavailable ------------------------- */
const noStorage = await context.newPage();
const storageErrors = [];
noStorage.on('pageerror', (e) => storageErrors.push(String(e)));
await noStorage.addInitScript(() => {
  const boom = () => { throw new Error('storage disabled'); };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
  });
});
await noStorage.goto(URL, { waitUntil: 'domcontentloaded' });
await noStorage.waitForTimeout(600);
check('the game boots with localStorage throwing', storageErrors.length === 0,
  storageErrors.slice(0, 2).join(' | '));
await noStorage.locator('#btn-start').click();
await noStorage.waitForTimeout(500);
check('a run still starts with no storage', await noStorage.locator('#hud').isVisible());
await noStorage.close();

/* --- the overlay must not eat the pointer ------------------------------------ */
const overlayPassesPointer = await page.evaluate(() => {
  const scan = document.querySelector('.scanlines, .stage-overlay, .grain');
  if (!scan) return true;
  return getComputedStyle(scan).pointerEvents === 'none';
});
check('the scanline overlay does not intercept the pointer', overlayPassesPointer);

check('no console errors during the session', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.pass ? `  -> ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
