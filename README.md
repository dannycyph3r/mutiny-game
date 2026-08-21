# MUTINY, a design system you can play

A lo-fi browser arena built out of the documented MUTINY game UI system. The
premise is that the system is not illustrated, it **runs**: the HUD is the
component set as real DOM, the canvas renderer reads the same custom properties
the HUD does, the ability window is 1.4 seconds and the cooldown 2.8 seconds
because the motion table says so, and the shape language is a mechanic rather
than a legend.

```bash
npm install
npm run dev        # http://localhost:5176
npm run typecheck
```

No build step is required to read it. There is no framework, no state library
and no asset pipeline: about 3,500 lines of TypeScript and CSS, five backdrops
totalling 160KB, and every sound synthesised at runtime.

---

## The argument

A design system document is a set of claims. This one claims a colour role
pairs with a shape, that an ability reads as ready, activated, cooling and ready
again on a fixed clock, that spacing sits on a 4px grid, and that the daylight
variant is a lightness shift holding hue and chroma. A static mock cannot test
any of that, because nothing in a mock is under load.

So the system was built as a game, where every one of those claims is either
true sixty times a second or visibly false.

### The shape language is a rule with a cost

Hostiles are chevrons, friendlies are circles, objectives are diamonds, and the
player is a cross. Shooting a circle breaks the combo and costs 250 points.
That is the entire argument for shape-plus-colour redundancy, expressed as a
scoring rule instead of a paragraph: a player who reads only the colour will
lose points, and a player who cannot see colour at all is not disadvantaged.

The player is a cross specifically because the other three silhouettes are
spoken for. The first version drew the player as a circle, which put the thing
you steer into the same shape class as the thing that penalises you for
shooting it.

### The motion table drives the mechanics

`--dur-ability-active: 1400ms` and `--dur-ability-cooldown: 2800ms` are not
decoration on top of a game balanced elsewhere. `ABILITY_SPECS` reads those
numbers, the HUD sweep animates against them, and the balance was tuned around
them. The pause screen prints them, so the interface states its own spec.

### The environment swap is one attribute

`data-env="day"` on the root element re-resolves every token. The HUD, the
particles, the arena wash and the canvas marks move together because they read
the same custom properties through one resolver.

---

## Architecture

```
src/
├── styles/
│   ├── tokens.css     colour roles in OKLCH, the 4px scale, type roles, motion
│   └── game.css       the fourteen documented components
├── game/
│   ├── types.ts       the shape of a run
│   ├── palette.ts     resolves tokens to canvas-usable sRGB, cached per environment
│   ├── audio.ts       nine synthesised voices, no audio files
│   ├── input.ts       keyboard, pointer and gamepad as equal paths
│   ├── world.ts       the simulation: 480x270, fixed timestep, pure step()
│   ├── render.ts      the canvas, enforcing the shape language
│   └── progress.ts    leaderboard, medals and settings, all storage guarded
└── main.ts            wiring, screens, the rAF loop
```

**Three decisions worth defending in an interview:**

1. **The simulation is exactly 480x270**, which is a quarter of the 1920x1080
   target in the brief and upscales to it by an integer factor. The lo-fi look
   is a property of the resolution rather than a filter, and positions are
   pixel-honest.

2. **The HUD is DOM, not canvas.** Drawing a HUD into the canvas would have been
   easier and would have thrown away the point: the readouts are the real
   components, with real focus, real live regions and real text.

3. **`step()` is a pure function of state, dt and input.** That is what makes
   118 assertions about the rules possible without a browser, and it is why the
   frame clamp (`Math.min(50, now - lastFrame)`) is the only place time enters.

---

## Design system

Colour roles are authored in OKLCH so the daylight variant is a lightness shift
holding hue and chroma. The documented hexes are the night set: `#0b0a08` base,
`#13100d` panels, `#e9a44a` accent, `#edaf53` health, `#70bfdc` nano, `#db4f4a`
hostile, `#7cd6b0` friendly, `#f2d572` objective, `#eec04d` warning.

Two places needed a role the original sheet did not name, and both were found by
measurement rather than by taste.

| Case | Measured | Resolution |
|---|---|---|
| The accent as a button label ground vs the accent as text | 3.52:1 in daylight | The accent has three jobs pulling lightness in opposite directions. `--primary` is the fill, `--primary-ink` is the accent against a surface for text and strokes alike, `--ink-on-primary` is the label on the fill. At night one value served all three, which is how the split stayed hidden. |
| Gameplay marks over photography | 1.0:1 to 2.9:1 at every wash value | See below. |

### The wash that did not work

Gameplay marks sit on backdrop art, so the first attempt was an opacity wash
over the backdrop: darken the art until the marks read. Measuring it across
every pixel of all five backdrops at six wash strengths showed it cannot work.
A mid-lightness red does not clear 3:1 against arbitrary photography at any
opacity, and the values that came closest erased the art they were washing.

So separation comes from geometry instead. Every mark is drawn twice, once one
pixel larger in `--arena-ground` and once in its own colour. The ground under
every mark is now identical in both environments, so the marks were measured
once and hold everywhere: hostile 4.94:1, friendly 11.66:1, objective 13.10:1,
rounds 9.53:1, player 17.28:1. The wash dropped to 30% and the backdrops became
visible for the first time.

The HUD gets the same treatment one layer up, because the cascade cannot see
what a readout is sitting on: two gradient scrims and opaque grounds under the
ability slots and the control hint.

---

## Accessibility

Targeting **WCAG 2.2 AA / AODA**, which for a game means the interface around
the game, and as much of the game as the genre allows.

| Area | Implementation |
|---|---|
| **Keyboard** | Every screen, tab and control is fully operable from the keyboard. Movement is WASD or arrows, aim follows the pointer or the right stick, abilities are 1 and 2. Nothing requires a pointer. |
| **Gamepad** | A first-class path rather than a remap: RT or A fires, X and Y trigger abilities, the D-pad drives menus. |
| **Focus** | Focus moves into each screen as it opens, but never on first paint, so the skip link stays the first tab stop. |
| **Live regions** | One polite region announces wave changes, ability results, upgrades and the leaderboard placement, so state changes are not only visual. |
| **Colour independence** | Shape carries meaning everywhere, and the health meter always pairs its colour with numerals. |
| **Motion** | `prefers-reduced-motion` collapses every duration token to 1ms, and a Reduce effects setting turns off shake, scanlines and the objective pulse. The scanlines are static with no flicker in any case. |
| **Targets** | Every control clears the 24px minimum; the ability slots are 44px. |
| **No network** | Fonts are a progressive enhancement over a system stack, sound is synthesised, and the backdrops are local. The game is fully playable offline. |

### Verification evidence

`bun verify-mutiny.ts` runs **118 assertions** against the simulation with no
browser: the documented timings, the ability cycle, the combo ladder, the
friendly-fire penalty, the wave curve, spawn bounds, the leaderboard and the
medals, plus the invariants that stop a run contradicting its own HUD.

`node mutiny-audit.mjs` drives the game end to end in Chromium: **71 checks**
covering a real keyboard playthrough, the intermission, the three pause tabs,
the debrief, the leaderboard, both environments, reduced motion, focus order,
the 390px viewport, vertical clipping inside the stage, and a boot with
`localStorage` throwing on every call.

Four defects those two caught, worth naming because "we tested it" means little
without them:

1. **Every translucent colour in the renderer was painting at full opacity.**
   The palette resolved tokens by reading the computed `color` off a probe
   element, on the assumption that computed colour is serialised as `rgb()`. A
   value authored in OKLCH computes to an OKLCH string, so the alpha helper
   could not take it apart and silently returned the opaque colour. The arena
   wash, the particle fade and the floater fade were all solid. The backdrop was
   invisible behind what was meant to be a 30% veil. Both the renderer and the
   audit harness had made the same assumption, in different code, on the same
   day.

2. **The `hidden` attribute was not hiding the HUD.** `.hud` sets
   `display: flex`, which beats the user-agent rule for `[hidden]`, so the HUD
   drew straight through the title screen. One global `[hidden]` rule now means
   no component can opt out by accident.

3. **The leaderboard reported rank zero.** `rankOf` searched the board for a row
   with a matching score, which returns nothing for a run that missed the top
   ten, and the debrief then said the score was saved when it had been sliced
   off. Placement is now counted rather than looked up, and `madeBoard` answers
   the separate question the message actually needed.

4. **The skip link was not the first tab stop.** Focusing the start button on
   first paint put it behind the very thing it exists to be in front of.

The browser harness also grew a check it did not have: the shared accessibility
sweep walks DOM ancestors for a background and stops at the root, so it cannot
see the arena. HUD text is now measured by taking the text colour from the live
styles, making the text transparent, photographing the stage and reading the
pixels behind each line box. That is what caught the ability slot key at 3.09:1
over a bright backdrop, which no cascade-only tool could have found.

---

## Scope and honesty

- The backdrops are Ubisoft Toronto NEXT concept art from the original brief,
  posterized and reduced to the simulation resolution. This is a portfolio
  exercise and is not affiliated with or endorsed by Ubisoft.
- The leaderboard is **local**: `localStorage`, guarded so the game works
  without it. There is no backend and no account.
- The gamepad path is implemented against the standard Gamepad API but was
  verified by code review rather than with a physical controller, since the
  build environment has none.
- Balance is tuned for a two to four minute run, not for depth. Wave pacing,
  hostile classes and the upgrade pool are deliberately small.
- The audio is nine oscillator envelopes. It is texture, not a score.

## Roadmap, if this continued

1. Remappable controls, which is the accessibility gap the current build has:
   the keys are sensible but they are fixed.
2. A difficulty curve that separates hostile pressure from time pressure, so
   the game stays readable for players who need longer to identify a shape.
3. Runs seeded and replayable, which would make the leaderboard meaningful and
   the balance testable end to end rather than only per rule.
