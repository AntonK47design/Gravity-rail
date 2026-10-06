import { Board, PieceProps, PlacedPiece } from './board';
import { PIECES, PieceType } from './components';
import { RAIL_Y, Vec3, levelY, v3 } from './grid';
import { SimMarkers, SimStats } from './simulation';

/** [x, z, level] */
export type Cell3 = [number, number, number];

export interface FixedDef {
  type: PieceType;
  at: Cell3;
  rot?: number;
  props?: PieceProps;
}

export interface Placement {
  type: PieceType;
  at: Cell3;
  rot: number;
  /** Splitter branch chosen by the player. */
  state?: number;
}

export type Challenge =
  | { kind: 'time'; seconds: number }
  | { kind: 'pieces'; max: number }
  | { kind: 'shards' }
  | { kind: 'checkpoint' }
  | { kind: 'avoid'; type: PieceType }
  | { kind: 'gentle'; maxSpeed: number };

export interface LevelDef {
  id: string;
  name: string;
  world: number;
  size: [number, number];
  maxLevel?: number;
  start: { at: Cell3; rot: number; speed?: number };
  goal: { at: Cell3; rot: number };
  fixed?: FixedDef[];
  inventory: Partial<Record<PieceType, number>>;
  /** Max components for the second star. */
  par: number;
  challenge: Challenge;
  shards?: Cell3[];
  /** Holes in the board ([x, z]). */
  voids?: [number, number][];
  checkpoint?: Cell3;
  /** One short line shown when the level opens. */
  intro?: string;
  /** Contextual hint offered after a couple of failed runs. */
  hint?: string;
  /** Show the reference solution as faint target cells (first-level onboarding). */
  guide?: boolean;
  /** Reference solution — verified by tests and used by the debug tools. */
  solution: Placement[];
  /** Reference solution that also earns the third star. */
  challengeSolution?: Placement[];
}

export function cellCentre(c: Cell3): Vec3 {
  return v3(c[0], levelY(c[2]) + RAIL_Y, c[1]);
}

export function buildBoard(level: LevelDef): Board {
  const [w, d] = level.size;
  const board = new Board(w, d, level.maxLevel ?? 6);
  for (const [x, z] of level.voids ?? []) board.voids.add(`${x},${z}`);
  board.add({ type: 'start', x: level.start.at[0], z: level.start.at[1], level: level.start.at[2], rot: level.start.rot, fixed: true, props: {} });
  board.add({ type: 'goal', x: level.goal.at[0], z: level.goal.at[1], level: level.goal.at[2], rot: level.goal.rot, fixed: true, props: {} });
  for (const f of level.fixed ?? []) {
    board.add({ type: f.type, x: f.at[0], z: f.at[1], level: f.at[2], rot: f.rot ?? 0, fixed: true, props: { ...(f.props ?? {}) } });
  }
  return board;
}

export function applyPlacements(board: Board, placements: Placement[]): PlacedPiece[] {
  return placements.map((p) =>
    board.add({ type: p.type, x: p.at[0], z: p.at[1], level: p.at[2], rot: p.rot, fixed: false, props: p.state !== undefined ? { state: p.state } : {} }),
  );
}

export function levelMarkers(level: LevelDef): SimMarkers {
  return {
    shards: level.shards?.map(cellCentre),
    checkpoint: level.checkpoint ? cellCentre(level.checkpoint) : undefined,
  };
}

/** Validates a level definition; returns a list of problems (empty = OK). */
export function validateLevel(level: LevelDef): string[] {
  const errors: string[] = [];
  try {
    const board = buildBoard(level);
    if (board.pieces.size < 2) errors.push('missing start/goal');
    for (const p of level.solution) {
      if (!PIECES[p.type]) errors.push(`unknown piece ${p.type}`);
    }
  } catch (e) {
    errors.push(String(e));
  }
  return errors;
}

export interface RunResult {
  won: boolean;
  stats: SimStats;
  piecesUsed: number;
  typesUsed: Set<PieceType>;
}

export interface StarResult {
  stars: number;
  par: boolean;
  challenge: boolean;
}

export function challengeMet(level: LevelDef, r: RunResult): boolean {
  const c = level.challenge;
  switch (c.kind) {
    case 'time':
      return r.stats.time <= c.seconds;
    case 'pieces':
      return r.piecesUsed <= c.max;
    case 'shards':
      return r.stats.shards.length > 0 && r.stats.shards.every(Boolean);
    case 'checkpoint':
      return r.stats.checkpoint;
    case 'avoid':
      return !r.typesUsed.has(c.type);
    case 'gentle':
      return r.stats.goalSpeed <= c.maxSpeed;
  }
}

export function scoreRun(level: LevelDef, r: RunResult): StarResult {
  if (!r.won) return { stars: 0, par: false, challenge: false };
  const par = r.piecesUsed <= level.par;
  const challenge = par && challengeMet(level, r);
  return { stars: 1 + (par ? 1 : 0) + (challenge ? 1 : 0), par, challenge };
}

export function challengeText(level: LevelDef): string {
  const c = level.challenge;
  switch (c.kind) {
    case 'time':
      return `Reach the goal within ${c.seconds}s`;
    case 'pieces':
      return `Use at most ${c.max} components`;
    case 'shards':
      return 'Collect every energy shard';
    case 'checkpoint':
      return 'Pass through the ring';
    case 'avoid':
      return `Don't use any ${PIECES[c.type].name}`;
    case 'gentle':
      return `Arrive gently (under ${c.maxSpeed.toFixed(1)} m/s)`;
  }
}
