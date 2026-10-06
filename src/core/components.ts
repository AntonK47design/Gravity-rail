import { LEVEL_H, RAIL_Y, Vec3, v3 } from './grid';

/**
 * Component (piece) catalogue. Everything here is data: local-space ports,
 * ball-centre paths and occupancy. Behaviour lives in simulation.ts and is
 * keyed by `type`, so new pieces only need a definition plus (optionally) a
 * behaviour case.
 */

export type PieceType =
  | 'track'
  | 'ramp'
  | 'curve'
  | 'drop'
  | 'kicker'
  | 'splitter'
  | 'booster'
  | 'brake'
  | 'gate'
  | 'switch'
  | 'timer'
  | 'teleporter'
  | 'launcher'
  | 'magnet'
  | 'collector'
  | 'start'
  | 'goal'
  | 'block';

export type Terminal = 'wall' | 'goal' | 'teleport' | 'launch';

export type PathEnd = { port: number } | { terminal: Terminal };

export interface PortDef {
  /** Local direction 0..3 (E,S,W,N). */
  dir: number;
  /** Level offset relative to the piece base level. */
  dy: number;
}

export interface PathDef {
  a: PathEnd;
  b: PathEnd;
  /** Local-space polyline of the ball centre, resampled to uniform spacing. */
  pts: Vec3[];
  /** Branch id for splitters (only the active branch is used when entering from the shared port). */
  branch?: number;
  /** Max speed before the sphere is thrown off (curves). */
  maxSpeed?: number;
}

export interface PieceDef {
  type: PieceType;
  name: string;
  blurb: string;
  color: number;
  ports: PortDef[];
  paths: PathDef[];
  /** Level offsets occupied above the base level. */
  occupancy: number[];
  /** Ballistic catch: horizontal radius around the cell centre. */
  catchRadius?: number;
  /** Shown in the toolbar (fixed-only pieces are not). */
  placeable: boolean;
  /** Has a player-toggleable state while building. */
  toggleable?: boolean;
}

export const CURVE_MAX_SPEED = 4.6;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function resample(raw: Vec3[], spacing = 0.025): Vec3[] {
  const cum: number[] = [0];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1];
    const b = raw[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(total / spacing) + 1);
  const out: Vec3[] = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (n - 1);
    while (j < cum.length - 1 && cum[j] < s) j++;
    const s0 = cum[j - 1];
    const s1 = cum[j];
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const a = raw[j - 1];
    const b = raw[j];
    out.push(v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
  }
  return out;
}

function sample(n: number, f: (t: number) => Vec3): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) pts.push(f(i / n));
  return pts;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

const straightPts = () => sample(8, (t) => v3(-0.5 + t, RAIL_Y, 0));
const westToCenter = () => sample(8, (t) => v3(-0.5 + 0.5 * t, RAIL_Y, 0));
const centerToEast = () => sample(8, (t) => v3(0.5 * t, RAIL_Y, 0));

/** Quarter arc in XZ around (cx, cz) with radius r between angles a0..a1. */
function arcXZ(cx: number, cz: number, r: number, a0: number, a1: number, y = RAIL_Y): Vec3[] {
  return sample(24, (t) => {
    const a = a0 + (a1 - a0) * t;
    return v3(cx + r * Math.cos(a), y, cz + r * Math.sin(a));
  });
}

function dropPts(): Vec3[] {
  const top = RAIL_Y + 2 * LEVEL_H;
  const r = 0.2;
  const pts: Vec3[] = [v3(-0.5, top, 0)];
  // horizontal → down
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI / 2 - (Math.PI / 2) * (i / 12);
    pts.push(v3(-r + r * Math.cos(a), top - r + r * Math.sin(a), 0));
  }
  // down → horizontal
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / 12);
    pts.push(v3(r + r * Math.cos(a), RAIL_Y + r + r * Math.sin(a), 0));
  }
  pts.push(v3(0.5, RAIL_Y, 0));
  return pts;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

const W = { port: 0 };
const E = { port: 1 };

function def(d: PieceDef): PieceDef {
  d.paths = d.paths.map((p) => ({ ...p, pts: resample(p.pts) }));
  return d;
}

export const PIECES: Record<PieceType, PieceDef> = {
  track: def({
    type: 'track',
    name: 'Rail',
    blurb: 'A straight rail. Keeps the sphere rolling.',
    color: 0x5ec8ff,
    ports: [{ dir: 2, dy: 0 }, { dir: 0, dy: 0 }],
    paths: [{ a: W, b: E, pts: straightPts() }],
    occupancy: [0],
    placeable: true,
  }),
  ramp: def({
    type: 'ramp',
    name: 'Slope',
    blurb: 'Changes height by one level. Rolling down builds speed.',
    color: 0x6ee7a8,
    ports: [{ dir: 2, dy: 1 }, { dir: 0, dy: 0 }],
    paths: [{ a: W, b: E, pts: sample(24, (t) => v3(-0.5 + t, RAIL_Y + LEVEL_H * (1 - smooth(t)), 0)) }],
    occupancy: [0, 1],
    placeable: true,
  }),
  curve: def({
    type: 'curve',
    name: 'Bend',
    blurb: 'Turns the sphere 90°. Too much speed throws it off.',
    color: 0xffc35e,
    ports: [{ dir: 2, dy: 0 }, { dir: 1, dy: 0 }],
    paths: [{ a: W, b: E, pts: arcXZ(-0.5, 0.5, 0.5, -Math.PI / 2, 0), maxSpeed: CURVE_MAX_SPEED }],
    occupancy: [0],
    placeable: true,
  }),
  drop: def({
    type: 'drop',
    name: 'Drop Shaft',
    blurb: 'A controlled two-level descent. Exits at a calm speed.',
    color: 0xa78bfa,
    ports: [{ dir: 2, dy: 2 }, { dir: 0, dy: 0 }],
    paths: [{ a: W, b: E, pts: dropPts() }],
    occupancy: [0, 1, 2],
    placeable: true,
  }),
  kicker: def({
    type: 'kicker',
    name: 'Kicker',
    blurb: 'Flicks the sphere into the air. Faster in = farther out.',
    color: 0xff8f6b,
    ports: [{ dir: 2, dy: 0 }],
    paths: [
      {
        a: W,
        b: { terminal: 'launch' },
        pts: sample(20, (t) => v3(-0.5 + t * 0.9, RAIL_Y + 0.2 * Math.max(0, (t - 0.35) / 0.65) ** 2, 0)),
      },
    ],
    occupancy: [0],
    placeable: true,
  }),
  splitter: def({
    type: 'splitter',
    name: 'Splitter',
    blurb: 'Sends the sphere left or right. Tap it to flip the route.',
    color: 0xf472b6,
    ports: [{ dir: 2, dy: 0 }, { dir: 3, dy: 0 }, { dir: 1, dy: 0 }],
    paths: [
      { a: W, b: { port: 1 }, pts: arcXZ(-0.5, -0.5, 0.5, Math.PI / 2, 0), branch: 0, maxSpeed: CURVE_MAX_SPEED },
      { a: W, b: { port: 2 }, pts: arcXZ(-0.5, 0.5, 0.5, -Math.PI / 2, 0), branch: 1, maxSpeed: CURVE_MAX_SPEED },
    ],
    occupancy: [0],
    placeable: true,
    toggleable: true,
  }),
  booster: def({
    type: 'booster',
    name: 'Booster',
    blurb: 'Accelerates the sphere in the arrow direction.',
    color: 0x34d399,
    ports: [{ dir: 2, dy: 0 }, { dir: 0, dy: 0 }],
    paths: [{ a: W, b: E, pts: straightPts() }],
    occupancy: [0],
    placeable: true,
  }),
  brake: def({
    type: 'brake',
    name: 'Brake',
    blurb: 'Slows a fast sphere down to a safe cruising speed.',
    color: 0xf87171,
    ports: [{ dir: 2, dy: 0 }, { dir: 0, dy: 0 }],
    paths: [{ a: W, b: E, pts: straightPts() }],
    occupancy: [0],
    placeable: true,
  }),
  gate: def({
    type: 'gate',
    name: 'Gate',
    blurb: 'Blocks the rail while closed. A matching switch toggles it.',
    color: 0xfbbf24,
    ports: [{ dir: 2, dy: 0 }, { dir: 0, dy: 0 }],
    paths: [{ a: W, b: E, pts: straightPts() }],
    occupancy: [0],
    placeable: true,
  }),
  switch: def({
    type: 'switch',
    name: 'Switch',
    blurb: 'Rolling over it toggles every gate and splitter of its colour.',
    color: 0xfbbf24,
    ports: [{ dir: 2, dy: 0 }, { dir: 0, dy: 0 }],
    paths: [{ a: W, b: E, pts: straightPts() }],
    occupancy: [0],
    placeable: true,
  }),
  timer: def({
    type: 'timer',
    name: 'Pulse Gate',
    blurb: 'Opens and closes on a steady rhythm. Arrive on the beat.',
    color: 0x22d3ee,
    ports: [{ dir: 2, dy: 0 }, { dir: 0, dy: 0 }],
    paths: [{ a: W, b: E, pts: straightPts() }],
    occupancy: [0],
    placeable: false,
  }),
  teleporter: def({
    type: 'teleporter',
    name: 'Portal',
    blurb: 'Enter one portal, leave from its twin at the same speed.',
    color: 0x8b5cf6,
    ports: [{ dir: 2, dy: 0 }],
    paths: [{ a: W, b: { terminal: 'teleport' }, pts: westToCenter() }],
    occupancy: [0],
    placeable: true,
  }),
  launcher: def({
    type: 'launcher',
    name: 'Launcher',
    blurb: 'Catches the sphere and fires it exactly three cells ahead.',
    color: 0xfb923c,
    ports: [{ dir: 2, dy: 0 }],
    paths: [{ a: W, b: { terminal: 'launch' }, pts: westToCenter() }],
    occupancy: [0],
    placeable: true,
  }),
  magnet: def({
    type: 'magnet',
    name: 'Magnet',
    blurb: 'Grabs a flying sphere nearby and redirects it, keeping its speed.',
    color: 0x60a5fa,
    ports: [{ dir: 0, dy: 0 }],
    paths: [{ a: { terminal: 'wall' }, b: { port: 0 }, pts: centerToEast() }],
    occupancy: [0],
    catchRadius: 1.25,
    placeable: true,
  }),
  collector: def({
    type: 'collector',
    name: 'Collector',
    blurb: 'A funnel that catches a falling sphere and rolls it out gently.',
    color: 0x2dd4bf,
    ports: [{ dir: 0, dy: 0 }],
    paths: [{ a: { terminal: 'wall' }, b: { port: 0 }, pts: centerToEast() }],
    occupancy: [0],
    catchRadius: 0.55,
    placeable: true,
  }),
  start: def({
    type: 'start',
    name: 'Start',
    blurb: 'The energy sphere is released here.',
    color: 0xe2e8f0,
    ports: [{ dir: 0, dy: 0 }],
    paths: [{ a: { terminal: 'wall' }, b: { port: 0 }, pts: centerToEast() }],
    occupancy: [0],
    placeable: false,
  }),
  goal: def({
    type: 'goal',
    name: 'Goal',
    blurb: 'Deliver the sphere here.',
    color: 0xfde68a,
    ports: [{ dir: 2, dy: 0 }],
    paths: [{ a: W, b: { terminal: 'goal' }, pts: westToCenter() }],
    occupancy: [0],
    catchRadius: 0.45,
    placeable: false,
  }),
  block: def({
    type: 'block',
    name: 'Pillar',
    blurb: 'Solid obstacle.',
    color: 0x334155,
    ports: [],
    paths: [],
    occupancy: [0],
    placeable: false,
  }),
};

/** Toolbar order. */
export const TOOL_ORDER: PieceType[] = [
  'track',
  'ramp',
  'curve',
  'drop',
  'kicker',
  'booster',
  'brake',
  'splitter',
  'switch',
  'gate',
  'launcher',
  'teleporter',
  'magnet',
  'collector',
];

export const CHANNEL_COLORS = [0xfbbf24, 0x38bdf8, 0xf472b6, 0x4ade80];

/** Launcher constants: fires LAUNCH_RANGE cells forward, landing at the same height. */
export const LAUNCH_RANGE = 3;
export const LAUNCH_VH = 3.2;
