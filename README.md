# Gravity Rail

**Build it. Start it. Watch the machine come alive.**

Gravity Rail is a 3D single-player physics construction puzzle for the browser. In each level you get a small
set of mechanical components. Place, rotate and connect them so that a glowing energy sphere rolls from
**START** to the **GOAL**, then press **PLAY** and watch your machine run.

It is built for web portals like **CrazyGames** and **Playgama**. There are no accounts and no backend,
it loads fast (≈200 KB gzipped, no external assets), works with mouse and touch, and saves progress
locally.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 (debug tools enabled)
npm test             # level verification + determinism suite
npm run build        # production build in dist/
npm run preview      # serve the production build
```

## GitHub Pages

`.github/workflows/deploy-pages.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to
`main` (or this development branch), and can also be run manually from the Actions tab. One-time setup:
**Settings → Pages → Build and deployment → Source: GitHub Actions**. The game is then served at
`https://<user>.github.io/<repo>/`. The build uses relative asset paths, so it works under any sub-path.

## Features

- **30 handcrafted levels in 5 worlds**: Foundations, Momentum, Machines, Energy and Mastermind.
  Each level comes with a reference solution, and the test suite checks that solution against the real
  simulation.
- **Three-star system**: ★ reach the goal, ★★ stay within the part limit, ★★★ also beat the level's
  challenge. Challenges include time limits, collecting shards, passing through a ring, arriving gently,
  avoiding a component type, or using fewer parts.
- **14 components**: Rail, Slope, Bend, Drop Shaft, Kicker, Booster, Brake, Splitter, Switch, Gate,
  Launcher, Portal, Magnet and Collector. Levels can also use Pulse Gates, pillars, holes, energy shards
  and checkpoint rings.
- **Smart construction**: pieces snap to the circuit automatically, picking the height and orientation
  that continue the energized rail (on average a player needs 0.1 rotations per placement). There is a
  live ghost preview with connection dots (green = connected, white = open, red = blocked), clear invalid
  feedback, undo, and a clear-all action that undo can reverse.
- **The circuit comes alive while you build**: rails connected to START glow, and PLAY pulses once the
  route reaches the GOAL.
- **Deterministic physics**: a fixed 240 Hz step with no randomness, so a solution that works once
  always works.
- **Procedural everything**: models, textures, music and sound effects are generated at runtime. There
  are no binary assets.
- **Quality levels** (Auto, Low, Medium, High) cover shadows, pixel ratio, bloom and particle density.
  Auto picks a sensible default per device.

## Shop, skins and daily rewards

- **Gears** are the in-game currency. You earn them by clearing a level for the first time (+20), for
  every new star (+10 each), and from the **daily reward**. The daily reward is a 7-day calendar
  (30 → 200 Gears) that restarts if you miss a day.
- The **Shop** (main menu, or click the Gears balance) sells eight sphere skins: Spark, Rose, Volt,
  Ember, Gilded, Void, Comet and Prism. Each skin changes the sphere's colour, glow and trail. Skins are
  purely cosmetic and never change the physics.
- Saves from before the shop existed are credited with the Gears they would have earned.
- The rules live in `src/meta/economy.ts` and the catalogue in `src/meta/skins.ts`. Both are covered by
  `tests/economy.test.ts`.

## Themes

The look is chosen at build time with `VITE_THEME`:

- **Midnight** (default, dark) is used by `npm run build` and the CrazyGames / Playgama builds.
- **Porcelain** (white) is used by `npm run build:pages`, which is what GitHub Pages deploys.

In dev you can preview it with `http://localhost:5173/?theme=porcelain`. Colours, lights and glow
settings live in `src/rendering/theme.ts`, and the UI colours in the `[data-theme='porcelain']` block of
`src/ui/styles.css`.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Pick component | Click toolbar / keys `1`–`9` | Tap toolbar |
| Place / select | Left click | Tap |
| Rotate | `R` (cycles placement options while placing) | ⟳ in the selection bubble |
| Raise / lower selected | `]` / `[` (PgUp / PgDn) | ▲ / ▼ in the bubble |
| Flip splitter | `T` or click it again | ⇄ in the bubble |
| Remove | `Delete` / `Backspace` | 🗑 in the bubble |
| Undo | `Z` | Undo button |
| Play / stop | `Space` | PLAY button |
| Fast-forward | `F` | ⏩ button |
| Orbit camera | Right / middle drag, `Q` / `E` | Two-finger drag |
| Pan | `Shift` + drag, `WASD` / arrow keys | One-finger drag |
| Zoom | Mouse wheel | Pinch |
| Reset camera | `C` | Camera button |
| Hint / mute / pause | `H` / `M` / `Esc` | HUD buttons |

## Architecture

```
src/
  core/           Pure, headless game logic (no DOM, no three.js), fully testable
    grid.ts         Coordinates, directions, constants
    components.ts   Component catalogue: ports, ball paths, occupancy (data only)
    board.ts        Placement rules, occupancy, port connectivity, smart candidates
    simulation.ts   Deterministic sphere physics + mechanism behaviour + events
    trace.ts        Static circuit walk used for "energized" build feedback
    history.ts      Undo stack
    level.ts        Level format, board construction, scoring / stars
    runner.ts       Headless runner (tests, debug)
  levels/         Level data only: world1..5.ts, showcase.ts, index.ts
  game/
    Game.ts         State machine, frame loop, level lifecycle, UI actions
    Builder.ts      Construction interactions (picking, placing, editing, undo)
    feedback.ts     Simulation events → particles, sound, camera shake
  rendering/      three.js: renderer + quality, environment/lighting, camera,
                  procedural piece models, board view, sphere view, particle effects
  ui/             DOM HUD, menus, level select, dialogs, icons, styles
  audio/          WebAudio engine, generative music, synthesized sound effects
  input/          Unified mouse / touch / gesture handling
  save/           localStorage persistence with in-memory fallback
  platform/       PlatformAdapter interface + CrazyGames / Playgama adapters (code-split)
  debug/          Developer panel (dev builds only)
tests/
  levels.test.ts  Verifies every level (solvable, stars reachable, deterministic)
```

### Physics model

The sphere is always in one of three modes:

- **Rail**: 1D motion along a piece's path. Acceleration is gravity projected on the tangent, minus
  rolling resistance and a little drag, plus piece behaviour: boosters drive towards a target speed,
  brakes clamp speed, gates bounce the sphere, and switches toggle their channel. Bends throw the sphere
  off if it goes faster than 4.6 m/s. When the sphere reaches a path end it follows the matching port
  into the neighbouring piece. If there is no neighbour, it flies.
- **Air**: ballistic flight. Collectors, the goal funnel and magnets can catch the sphere, and it can
  land on any rail. It crashes into solid parts and fails if it hits the board or falls through a hole.
- **Hold**: a short scripted capture used by launchers, magnets and collectors.

Failures are always explained: *fell off the track*, *crashed*, *ran out of energy*, *too fast for that
bend*, or *got lost* (time limit).

### Level format

Levels are plain data in `src/levels/worldN.ts`. Game logic never refers to a specific level.

```ts
{
  id: 'w1-2', name: 'Downhill', world: 1,
  size: [6, 3],                         // board cells (x, z)
  start: { at: [0, 1, 1], rot: 0 },     // [x, z, level]; rot = facing (0 E, 1 S, 2 W, 3 N)
  goal:  { at: [4, 1, 0], rot: 0 },     // goal rot: 0 = sphere arrives travelling east
  fixed: [{ type: 'block', at: [2, 2, 0], props: { height: 2 } }],
  voids: [[3, 0]],                      // holes in the board
  inventory: { track: 3, ramp: 1 },
  par: 3,                               // ★★ part limit
  challenge: { kind: 'time', seconds: 1.7 },
  shards: [[2, 1, 0]], checkpoint: [3, 1, 1],
  intro: 'Shown when the level opens.',
  hint: 'Offered after two failed runs.',
  solution: [ { type: 'ramp', at: [1, 1, 0], rot: 0 }, … ],
  challengeSolution: [ … ],             // optional: a solution that earns ★★★
}
```

To add a level, append it to a world file and run `npm test`. The suite fails if the reference solution
doesn't reach the goal, exceeds the inventory or par, can't earn three stars, or if the level is solved
by an empty board.

Rotation reference for common pieces (`rot` turns local directions clockwise seen from above):

- **Rail**: rot 0 runs E–W, rot 1 runs N–S.
- **Slope**: the high end is local west, so rot 0 descends towards +x and rot 1 descends towards +z.
- **Bend**: rot 0 connects W–S, rot 1 N–W, rot 2 E–N, rot 3 S–E.
- **Directional pieces** (Booster, Kicker, Launcher, Drop): rot equals the direction of travel.
- **Portal, Goal**: the port faces local west, so for the goal rot = the direction the sphere arrives in, and for an exit portal
  rot = (exit direction + 2) mod 4.

## Platform integration

The game talks only to `PlatformAdapter` (`src/platform/PlatformAdapter.ts`), which has
loading / gameplay start and stop, `happyTime`, `commercialBreak` and an optional audio hook. The adapter
is chosen at boot:

- `?platform=crazygames` / `?platform=playgama` in the URL, or
- automatic detection from the host or referrer, or
- `VITE_PLATFORM=crazygames npm run build`.

The adapters load the SDK with a timeout and fall back to a no-op local adapter if it isn't available.
The core game never depends on an external service. Midgame ads are requested only at natural breaks
(every third completed level), and audio is suspended while an ad plays.

### Building for a portal

```bash
npm run build:crazygames   # → gravity-rail-crazygames.zip (CrazyGames SDK v3 forced on)
npm run build:playgama     # → gravity-rail-playgama.zip   (Playgama Bridge forced on)
```

Each zip has `index.html` at its root and is ready to upload. On CrazyGames, open the developer portal,
submit a new HTML5 game with the zip, then use their preview / QA tool to check the SDK events.

## Saving

Progress is stored in `localStorage` (`gravityrail.save.v1`): unlocked levels (derived from completions),
stars, best times, the last construction of every level, and all settings. If storage is unavailable,
for example in private mode or a sandboxed iframe, the game runs from memory.

## Debug tools (development only)

Press <kbd>`</kbd> in `npm run dev` to load solutions (★ or ★★★), skip, reload or switch levels, toggle
collision paths and catch radii, show grid coordinates and the FPS / draw-call counter, enable unlimited
components or unlock every level, reset the save, and inspect the live sphere state. The panel is
imported only when `import.meta.env.DEV` is true, so it is tree-shaken out of production builds.

## Performance notes

- Shared geometry and material caches. Board sockets and pillars are instanced, and every particle is
  drawn by a single `Points` call.
- Bloom (High quality only) is code-split and downloaded on demand.
- Shadows are off on Low. The shadow camera is fitted tightly to each board.
- Rendering pauses while the tab is hidden, and the frame loop clamps `dt` and recovers from errors.
- After the first load the game needs no network, apart from the optional platform SDK.

## Credits & IP

All code, models, music and sound in Gravity Rail are original and generated procedurally for this project.
Gravity Rail is inspired by the general idea of marble-run construction toys, but it uses no third-party
brand, asset, name or level layout.
