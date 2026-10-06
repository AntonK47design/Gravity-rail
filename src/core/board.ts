import { PIECES, PathEnd, PieceType } from './components';
import { DIR_VEC, LEVEL_H, RAIL_Y, Vec3, levelY, oppositeDir, rotDir, rotXZ, v3, voxelKey } from './grid';

export interface PieceProps {
  /** Colour channel for gates / switches / portals / splitters. */
  channel?: number;
  /** Splitter branch (0/1) or gate open (1) / closed (0). */
  state?: number;
  /** Pulse gate period in seconds and phase offset. */
  period?: number;
  phase?: number;
  /** Block height in levels. */
  height?: number;
}

export interface PlacedPiece {
  id: number;
  type: PieceType;
  x: number;
  z: number;
  level: number;
  rot: number;
  fixed: boolean;
  props: PieceProps;
}

export interface WorldPath {
  pieceId: number;
  index: number;
  pts: Vec3[];
  cum: number[];
  length: number;
  a: PathEnd;
  b: PathEnd;
  branch?: number;
  maxSpeed?: number;
}

export interface WorldPort {
  pieceId: number;
  index: number;
  dir: number;
  height: number;
  pos: Vec3;
  key: string;
}

export type PortStatus = 'connected' | 'open' | 'blocked';

export type PlaceError = 'bounds' | 'occupied' | 'height' | 'none-left' | 'fixed';

export interface Candidate {
  x: number;
  z: number;
  level: number;
  rot: number;
  valid: boolean;
  error?: PlaceError;
  connections: number;
  ports: { pos: Vec3; dir: number; status: PortStatus }[];
  score: number;
}

export function pieceOccupancy(p: Pick<PlacedPiece, 'type' | 'props'>): number[] {
  if (p.type === 'block') {
    const h = Math.max(1, p.props.height ?? 1);
    return Array.from({ length: h }, (_, i) => i);
  }
  return PIECES[p.type].occupancy;
}

function edgeKey(x: number, z: number, dir: number, height: number): string {
  const [dx, dz] = DIR_VEC[dir];
  return `${2 * x + dx},${2 * z + dz},${height}`;
}

export function computePorts(p: Omit<PlacedPiece, 'id' | 'fixed' | 'props'> & { id?: number }): WorldPort[] {
  const def = PIECES[p.type];
  return def.ports.map((port, index) => {
    const dir = rotDir(port.dir, p.rot);
    const height = p.level + port.dy;
    const [dx, dz] = DIR_VEC[dir];
    return {
      pieceId: p.id ?? -1,
      index,
      dir,
      height,
      pos: v3(p.x + dx * 0.5, levelY(height) + RAIL_Y, p.z + dz * 0.5),
      key: edgeKey(p.x, p.z, dir, height),
    };
  });
}

export function computePaths(p: PlacedPiece): WorldPath[] {
  const def = PIECES[p.type];
  const baseY = levelY(p.level);
  return def.paths.map((path, index) => {
    const pts = path.pts.map((q) => {
      const [rx, rz] = rotXZ(q.x, q.z, p.rot);
      return v3(p.x + rx, baseY + q.y, p.z + rz);
    });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    return {
      pieceId: p.id,
      index,
      pts,
      cum,
      length: cum[cum.length - 1],
      a: path.a,
      b: path.b,
      branch: path.branch,
      maxSpeed: path.maxSpeed,
    };
  });
}

/** Position + unit tangent at arc length s along a world path. */
export function samplePath(path: WorldPath, s: number, out: Vec3, tan?: Vec3): void {
  const { pts, cum } = path;
  const n = pts.length;
  if (s <= 0) s = 0;
  if (s >= path.length) s = path.length;
  // uniform spacing → direct index estimate, then fix up
  let i = Math.min(n - 2, Math.max(0, Math.floor((s / path.length) * (n - 1))));
  while (i > 0 && cum[i] > s) i--;
  while (i < n - 2 && cum[i + 1] < s) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const seg = cum[i + 1] - cum[i];
  const t = seg > 1e-9 ? (s - cum[i]) / seg : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  if (tan) {
    const inv = seg > 1e-9 ? 1 / seg : 0;
    tan.x = (b.x - a.x) * inv;
    tan.y = (b.y - a.y) * inv;
    tan.z = (b.z - a.z) * inv;
  }
}

/** Closest arc length on the path to a point (brute force over samples — paths are short). */
export function nearestOnPath(path: WorldPath, p: Vec3): { s: number; d2: number; dh2: number } {
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i < path.pts.length; i++) {
    const q = path.pts[i];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dz = q.z - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) {
      best = d2;
      bestI = i;
    }
  }
  const q = path.pts[bestI];
  return { s: path.cum[bestI], d2: best, dh2: (q.x - p.x) ** 2 + (q.z - p.z) ** 2 };
}

/**
 * The board: placed pieces, occupancy, port connectivity and placement rules.
 * Pure data — no rendering — so it can run in tests.
 */
export class Board {
  readonly pieces = new Map<number, PlacedPiece>();
  private occ = new Map<string, number>();
  private portMap = new Map<string, WorldPort[]>();
  private paths = new Map<number, WorldPath[]>();
  private ports = new Map<number, WorldPort[]>();
  private nextId = 1;
  version = 0;
  /** Cells that are holes in the board: nothing can be built there and the sphere falls through. */
  readonly voids = new Set<string>();

  constructor(
    public readonly width: number,
    public readonly depth: number,
    public readonly maxLevel: number,
  ) {}

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth;
  }

  isVoid(x: number, z: number): boolean {
    return this.voids.has(`${x},${z}`);
  }

  occupantAt(x: number, level: number, z: number): PlacedPiece | undefined {
    const id = this.occ.get(voxelKey(x, level, z));
    return id === undefined ? undefined : this.pieces.get(id);
  }

  piecesInColumn(x: number, z: number): PlacedPiece[] {
    const out: PlacedPiece[] = [];
    for (const p of this.pieces.values()) if (p.x === x && p.z === z) out.push(p);
    return out;
  }

  pathsOf(id: number): WorldPath[] {
    return this.paths.get(id) ?? [];
  }

  portsOf(id: number): WorldPort[] {
    return this.ports.get(id) ?? [];
  }

  /** The other port sharing an edge+height with this one, if any. */
  partnerPort(port: WorldPort): WorldPort | undefined {
    const list = this.portMap.get(port.key);
    if (!list) return undefined;
    return list.find((q) => q.pieceId !== port.pieceId && q.dir === oppositeDir(port.dir));
  }

  checkPlacement(type: PieceType, x: number, z: number, level: number, props: PieceProps = {}, ignoreId?: number): PlaceError | null {
    if (!this.inBounds(x, z) || this.isVoid(x, z)) return 'bounds';
    const occ = pieceOccupancy({ type, props });
    for (const dy of occ) {
      const l = level + dy;
      if (l < 0 || l > this.maxLevel) return 'height';
      const id = this.occ.get(voxelKey(x, l, z));
      if (id !== undefined && id !== ignoreId) return 'occupied';
    }
    return null;
  }

  add(p: Omit<PlacedPiece, 'id'> & { id?: number }): PlacedPiece {
    const id = p.id ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    const piece: PlacedPiece = { ...p, id, props: { ...p.props } };
    this.pieces.set(id, piece);
    this.index(piece);
    this.version++;
    return piece;
  }

  remove(id: number): PlacedPiece | undefined {
    const p = this.pieces.get(id);
    if (!p) return undefined;
    this.unindex(p);
    this.pieces.delete(id);
    this.version++;
    return p;
  }

  /** Re-index after mutating rot/level/position of a piece. */
  update(id: number, patch: Partial<Pick<PlacedPiece, 'x' | 'z' | 'level' | 'rot'>>): void {
    const p = this.pieces.get(id);
    if (!p) return;
    this.unindex(p);
    Object.assign(p, patch);
    this.index(p);
    this.version++;
  }

  private index(p: PlacedPiece): void {
    for (const dy of pieceOccupancy(p)) this.occ.set(voxelKey(p.x, p.level + dy, p.z), p.id);
    const ports = computePorts(p);
    this.ports.set(p.id, ports);
    for (const port of ports) {
      const list = this.portMap.get(port.key) ?? [];
      list.push(port);
      this.portMap.set(port.key, list);
    }
    this.paths.set(p.id, computePaths(p));
  }

  private unindex(p: PlacedPiece): void {
    for (const dy of pieceOccupancy(p)) {
      const k = voxelKey(p.x, p.level + dy, p.z);
      if (this.occ.get(k) === p.id) this.occ.delete(k);
    }
    for (const port of this.ports.get(p.id) ?? []) {
      const list = this.portMap.get(port.key);
      if (!list) continue;
      const next = list.filter((q) => q.pieceId !== p.id);
      if (next.length) this.portMap.set(port.key, next);
      else this.portMap.delete(port.key);
    }
    this.ports.delete(p.id);
    this.paths.delete(p.id);
  }

  /** Status of a hypothetical port (used for previews). */
  portStatus(x: number, z: number, dir: number, height: number, selfId?: number): PortStatus {
    const key = edgeKey(x, z, dir, height);
    const list = this.portMap.get(key);
    if (list && list.some((q) => q.pieceId !== selfId && q.dir === oppositeDir(dir))) return 'connected';
    const [dx, dz] = DIR_VEC[dir];
    const nx = x + dx;
    const nz = z + dz;
    const occupant = this.occupantAt(nx, height, nz);
    if (occupant && occupant.id !== selfId) return 'blocked';
    return 'open';
  }

  evaluate(type: PieceType, x: number, z: number, level: number, rot: number, ignoreId?: number): Candidate {
    const error = this.checkPlacement(type, x, z, level, {}, ignoreId);
    const ports = computePorts({ type, x, z, level, rot }).map((port) => ({
      pos: port.pos,
      dir: port.dir,
      status: this.portStatus(x, z, port.dir, port.height, ignoreId),
    }));
    const connections = ports.filter((p) => p.status === 'connected').length;
    const blocked = ports.filter((p) => p.status === 'blocked').length;
    return {
      x,
      z,
      level,
      rot,
      valid: !error,
      error: error ?? undefined,
      connections,
      ports,
      score: connections * 10 - blocked * 4,
    };
  }

  /**
   * Smart placement: rank every (level, rotation) for a cell, favouring
   * placements that connect to existing open ports.
   */
  candidates(type: PieceType, x: number, z: number, preferLevel: number, preferRot: number, ignoreId?: number): Candidate[] {
    const out: Candidate[] = [];
    if (!this.inBounds(x, z)) return out;
    for (let level = 0; level <= this.maxLevel; level++) {
      for (let rot = 0; rot < 4; rot++) {
        const c = this.evaluate(type, x, z, level, rot, ignoreId);
        if (!c.valid) continue;
        c.score += rot === preferRot ? 1.5 : 0;
        c.score -= Math.abs(level - preferLevel) * 1.2;
        out.push(c);
      }
    }
    out.sort((a, b) => b.score - a.score || a.level - b.level || a.rot - b.rot);
    // Rotations that produce an identical port set (e.g. symmetric pieces) are duplicates.
    const seen = new Set<string>();
    return out.filter((c) => {
      const sig = `${c.level}|` + c.ports.map((p) => `${p.dir}:${p.pos.y.toFixed(2)}`).sort().join(',') + (PIECE_DIRECTIONAL.has(type) ? `|${c.rot}` : '');
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  }

  /** Height of the highest solid top under (x,z) at or below `level` — used for support pillars. */
  supportBase(x: number, z: number, level: number): number {
    for (let l = level - 1; l >= 0; l--) {
      const p = this.occupantAt(x, l, z);
      if (p) return levelY(l) + (p.type === 'block' ? LEVEL_H : 0.16);
    }
    return 0;
  }

  clearPlayerPieces(): PlacedPiece[] {
    const removed: PlacedPiece[] = [];
    for (const p of [...this.pieces.values()]) if (!p.fixed) removed.push(this.remove(p.id)!);
    return removed;
  }

  playerPieces(): PlacedPiece[] {
    return [...this.pieces.values()].filter((p) => !p.fixed);
  }
}

/** Pieces whose behaviour depends on direction even when the port layout is symmetric. */
const PIECE_DIRECTIONAL = new Set<PieceType>(['booster', 'launcher', 'kicker', 'teleporter', 'magnet', 'collector']);
