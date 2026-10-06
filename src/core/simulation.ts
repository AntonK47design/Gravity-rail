import { Board, PlacedPiece, WorldPath, nearestOnPath, samplePath } from './board';
import { LAUNCH_RANGE, LAUNCH_VH, PathEnd, PIECES } from './components';
import { BALL_R, DIR_VEC, LEVEL_H, RAIL_Y, Vec3, levelY, rotDir, v3 } from './grid';

/**
 * Deterministic sphere simulation.
 *
 * The sphere is either riding a rail (1D physics along a path: gravity
 * projected on the tangent, rolling resistance, drag and piece behaviours)
 * or flying (simple ballistic integration with catch / landing / crash
 * checks). Fixed time step, no randomness — the same board always produces
 * the same run, so puzzle solutions are repeatable.
 */

export const SIM_DT = 1 / 240;
export const G = 7;
const MU = 0.12;
const DRAG = 0.012;
export const START_SPEED = 2.0;
export const BOOST_TARGET = 4.4;
const BOOST_ACC = 16;
export const BRAKE_TARGET = 1.8;
const BRAKE_ACC = 16;
const DROP_EXIT = 2.6;
const COLLECT_SPEED = 2.2;
const MAGNET_MIN = 2.6;
const MAGNET_MAX = 6;
const TIME_LIMIT = 60;

export type SimMode = 'rail' | 'air' | 'hold' | 'won' | 'failed';
export type FailReason = 'fell' | 'crash' | 'stalled' | 'derail' | 'timeout';

export type SimEvent =
  | { type: 'boost'; pos: Vec3; pieceId: number }
  | { type: 'brake'; pos: Vec3; pieceId: number }
  | { type: 'bounce'; pos: Vec3; pieceId: number; speed: number }
  | { type: 'switch'; pos: Vec3; pieceId: number; channel: number }
  | { type: 'teleport'; from: Vec3; to: Vec3 }
  | { type: 'launch'; pos: Vec3; speed: number }
  | { type: 'land'; pos: Vec3; impact: number }
  | { type: 'catch'; pos: Vec3; pieceId: number }
  | { type: 'derail'; pos: Vec3 }
  | { type: 'shard'; pos: Vec3; index: number }
  | { type: 'checkpoint'; pos: Vec3 }
  | { type: 'enter'; pieceId: number }
  | { type: 'win'; pos: Vec3 }
  | { type: 'fail'; pos: Vec3; reason: FailReason };

export interface SimMarkers {
  shards?: Vec3[];
  checkpoint?: Vec3;
}

export interface SimStats {
  time: number;
  maxSpeed: number;
  goalSpeed: number;
  visited: Set<number>;
  shards: boolean[];
  checkpoint: boolean;
}

interface Hold {
  t: number;
  dur: number;
  from: Vec3;
  to: Vec3;
  then: () => void;
}

export function gateOpenAt(p: PlacedPiece, time: number): boolean {
  const period = p.props.period ?? 2;
  const phase = p.props.phase ?? 0;
  const t = (((time + phase) % period) + period) % period;
  return t < period / 2;
}

/** Launch velocity for a launcher piece (world). */
export function launcherVelocity(p: PlacedPiece): Vec3 {
  const d = rotDir(0, p.rot);
  const [dx, dz] = DIR_VEC[d];
  const T = LAUNCH_RANGE / LAUNCH_VH;
  return v3(dx * LAUNCH_VH, (G * T) / 2, dz * LAUNCH_VH);
}

export class Simulation {
  mode: SimMode = 'rail';
  time = 0;
  readonly pos = v3();
  readonly vel = v3();
  /** Rail state */
  path!: WorldPath;
  s = 0;
  v = 0;
  speed = 0;
  failReason: FailReason | null = null;
  events: SimEvent[] = [];
  readonly stats: SimStats;
  /** Runtime state, keyed by piece id (gates: 1 = open, splitters: branch). */
  readonly state = new Map<number, number>();

  private readonly tan = v3();
  private hold: Hold | null = null;
  private lastPieceId = -1;
  private airTime = 0;
  private stillTime = 0;
  private failTime = 0;
  private derailing = false;
  private catchers: PlacedPiece[] = [];

  constructor(
    private readonly board: Board,
    private readonly markers: SimMarkers = {},
    startSpeed = START_SPEED,
  ) {
    this.stats = {
      time: 0,
      maxSpeed: 0,
      goalSpeed: 0,
      visited: new Set(),
      shards: (markers.shards ?? []).map(() => false),
      checkpoint: false,
    };
    let start: PlacedPiece | undefined;
    for (const p of board.pieces.values()) {
      if (p.type === 'start') start = p;
      if (p.type === 'gate' || p.type === 'splitter') this.state.set(p.id, p.props.state ?? (p.type === 'gate' ? 0 : 0));
      if (PIECES[p.type].catchRadius) this.catchers.push(p);
    }
    if (!start) throw new Error('Level has no start');
    this.enterPath(board.pathsOf(start.id)[0], 0.02, startSpeed);
    samplePath(this.path, this.s, this.pos, this.tan);
  }

  get done(): boolean {
    return this.mode === 'won' || (this.mode === 'failed' && this.failTime > 1.4);
  }

  isGateOpen(p: PlacedPiece): boolean {
    if (p.type === 'timer') return gateOpenAt(p, this.time);
    return (this.state.get(p.id) ?? 0) === 1;
  }

  splitterBranch(p: PlacedPiece): number {
    return this.state.get(p.id) ?? 0;
  }

  step(dt = SIM_DT): void {
    if (this.mode === 'won') return;
    if (this.mode === 'failed') {
      this.failTime += dt;
      this.stepDebris(dt);
      return;
    }
    this.time += dt;
    this.stats.time = this.time;
    if (this.time > TIME_LIMIT) return this.fail('timeout');

    if (this.mode === 'hold') this.stepHold(dt);
    else if (this.mode === 'rail') this.stepRail(dt);
    else this.stepAir(dt);

    if ((this.mode as SimMode) !== 'failed' && (this.mode as SimMode) !== 'won') this.checkMarkers();
    if (this.speed > this.stats.maxSpeed) this.stats.maxSpeed = this.speed;
  }

  // -------------------------------------------------------------------------

  private piece(id: number): PlacedPiece {
    return this.board.pieces.get(id)!;
  }

  private enterPath(path: WorldPath, s: number, v: number): void {
    this.path = path;
    this.s = s;
    this.v = v;
    this.mode = 'rail';
    if (path.pieceId !== this.lastPieceId) {
      this.stats.visited.add(path.pieceId);
      this.events.push({ type: 'enter', pieceId: path.pieceId });
    }
    this.lastPieceId = path.pieceId;
  }

  private stepRail(dt: number): void {
    const path = this.path;
    const piece = this.piece(path.pieceId);
    samplePath(path, this.s, this.pos, this.tan);
    const tan = this.tan;
    let v = this.v;

    const gravity = -G * tan.y;
    let a = gravity;
    if (Math.abs(v) > 1e-4) a -= Math.sign(v) * (MU + DRAG * v * v);

    if (piece.type === 'booster') {
      // Booster arrow points toward path end b (local +X).
      if (v < BOOST_TARGET) {
        a += BOOST_ACC;
        if (this.time % 0.1 < dt) this.events.push({ type: 'boost', pos: v3(this.pos.x, this.pos.y, this.pos.z), pieceId: piece.id });
      }
    } else if (piece.type === 'brake') {
      if (Math.abs(v) > BRAKE_TARGET) {
        a -= Math.sign(v) * BRAKE_ACC;
        if (this.time % 0.1 < dt) this.events.push({ type: 'brake', pos: v3(this.pos.x, this.pos.y, this.pos.z), pieceId: piece.id });
      }
    }

    const vPrev = v;
    v += a * dt;
    if (piece.type === 'brake' && Math.abs(vPrev) > BRAKE_TARGET && Math.abs(v) < BRAKE_TARGET) v = Math.sign(vPrev) * BRAKE_TARGET;
    if (piece.type === 'booster' && vPrev < BOOST_TARGET && v > BOOST_TARGET) v = BOOST_TARGET;
    // Rolling resistance can stop the sphere but never reverse it on its own.
    if (vPrev !== 0 && Math.sign(v) !== Math.sign(vPrev) && Math.abs(gravity) < MU) v = 0;
    if (vPrev === 0 && Math.abs(gravity) < MU) v = 0;

    // Stall detection: resting on a (near) flat rail.
    if (Math.abs(v) < 0.05 && Math.abs(gravity) < MU * 1.5) {
      this.stillTime += dt;
      if (this.stillTime > 0.9) return this.fail('stalled');
    } else this.stillTime = 0;

    const sPrev = this.s;
    let s = sPrev + v * dt;

    // Mid-piece mechanisms
    const mid = path.length / 2;
    if ((sPrev - mid) * (s - mid) < 0 || (s === mid && sPrev !== mid)) {
      if (piece.type === 'gate' || piece.type === 'timer') {
        if (!this.isGateOpen(piece)) {
          this.events.push({ type: 'bounce', pos: v3(this.pos.x, this.pos.y, this.pos.z), pieceId: piece.id, speed: Math.abs(v) });
          s = mid - Math.sign(v) * 0.002;
          v = -v * 0.35;
        }
      } else if (piece.type === 'switch') {
        this.toggleChannel(piece.props.channel ?? 0);
        this.events.push({ type: 'switch', pos: v3(this.pos.x, this.pos.y, this.pos.z), pieceId: piece.id, channel: piece.props.channel ?? 0 });
      }
    }

    this.v = v;
    this.s = s;
    this.speed = Math.abs(v);

    if (path.maxSpeed && Math.abs(v) > path.maxSpeed) {
      this.derail();
      return;
    }

    if (s > path.length) this.leaveEnd(path.b, s - path.length, 1);
    else if (s < 0) this.leaveEnd(path.a, -s, -1);

    if (this.mode === 'rail') samplePath(this.path, this.s, this.pos, this.tan);
  }

  private leaveEnd(end: PathEnd, overflow: number, dirSign: 1 | -1): void {
    const path = this.path;
    const piece = this.piece(path.pieceId);
    const speed = Math.abs(this.v);

    if ('terminal' in end) {
      switch (end.terminal) {
        case 'wall':
          this.s = dirSign > 0 ? path.length - overflow : overflow;
          this.v = -this.v * 0.5;
          if (Math.abs(this.v) < 0.12) this.v = 0;
          this.events.push({ type: 'bounce', pos: v3(this.pos.x, this.pos.y, this.pos.z), pieceId: piece.id, speed });
          return;
        case 'goal':
          this.s = dirSign > 0 ? path.length : 0;
          samplePath(path, this.s, this.pos);
          return this.win(speed);
        case 'teleport': {
          const twin = this.findTwin(piece);
          if (!twin) {
            this.s = dirSign > 0 ? path.length - overflow : overflow;
            this.v = -this.v * 0.5;
            return;
          }
          const from = v3(this.pos.x, this.pos.y, this.pos.z);
          const twinPath = this.board.pathsOf(twin.id)[0];
          // Twin path runs port(a) → centre(b); leave toward the port.
          this.enterPath(twinPath, twinPath.length - Math.min(overflow, 0.01), -speed);
          samplePath(twinPath, this.s, this.pos, this.tan);
          this.events.push({ type: 'teleport', from, to: v3(this.pos.x, this.pos.y, this.pos.z) });
          return;
        }
        case 'launch': {
          samplePath(path, dirSign > 0 ? path.length : 0, this.pos, this.tan);
          if (piece.type === 'launcher') {
            const centre = v3(piece.x, levelY(piece.level) + RAIL_Y, piece.z);
            const vel = launcherVelocity(piece);
            this.startHold(0.22, centre, () => {
              this.goAir(vel);
              this.events.push({ type: 'launch', pos: v3(this.pos.x, this.pos.y, this.pos.z), speed: LAUNCH_VH });
            });
          } else {
            // Kicker: leave along the lip tangent.
            this.goAir(v3(this.tan.x * this.v, this.tan.y * this.v, this.tan.z * this.v));
            this.events.push({ type: 'launch', pos: v3(this.pos.x, this.pos.y, this.pos.z), speed });
          }
          return;
        }
      }
    }

    // Port: find a connected neighbour.
    const port = this.board.portsOf(piece.id)[end.port];
    let outSpeed = speed;
    if (piece.type === 'drop' && end.port === 1) outSpeed = Math.min(outSpeed, DROP_EXIT);
    const partner = port && this.board.partnerPort(port);
    if (!partner) {
      samplePath(path, dirSign > 0 ? path.length : 0, this.pos, this.tan);
      const sgn = dirSign;
      this.goAir(v3(this.tan.x * outSpeed * sgn, this.tan.y * outSpeed * sgn, this.tan.z * outSpeed * sgn));
      return;
    }
    const next = this.board.pieces.get(partner.pieceId)!;
    const paths = this.board.pathsOf(next.id).filter(
      (p) => ('port' in p.a && p.a.port === partner.index) || ('port' in p.b && p.b.port === partner.index),
    );
    let chosen = paths[0];
    if (paths.length > 1) {
      const branch = this.splitterBranch(next);
      chosen = paths.find((p) => p.branch === branch) ?? paths[0];
    }
    const enterAtA = 'port' in chosen.a && chosen.a.port === partner.index;
    const ov = Math.min(overflow, chosen.length * 0.5);
    if (enterAtA) this.enterPath(chosen, ov, outSpeed);
    else this.enterPath(chosen, chosen.length - ov, -outSpeed);
  }

  private findTwin(p: PlacedPiece): PlacedPiece | undefined {
    const ch = p.props.channel ?? 0;
    for (const q of this.board.pieces.values()) {
      if (q.id !== p.id && q.type === 'teleporter' && (q.props.channel ?? 0) === ch) return q;
    }
    return undefined;
  }

  private toggleChannel(channel: number): void {
    for (const p of this.board.pieces.values()) {
      if ((p.props.channel ?? 0) !== channel) continue;
      if (p.type === 'gate') this.state.set(p.id, 1 - (this.state.get(p.id) ?? 0));
      if (p.type === 'splitter' && p.props.channel !== undefined) this.state.set(p.id, 1 - (this.state.get(p.id) ?? 0));
    }
  }

  private derail(): void {
    samplePath(this.path, this.s, this.pos, this.tan);
    const v = this.v;
    // Outward kick: away from the curve centre (approximate with next-sample turn).
    const ahead = v3();
    samplePath(this.path, this.s + Math.sign(v) * 0.08, ahead);
    const vx = this.tan.x * v;
    const vz = this.tan.z * v;
    const turnX = ahead.x - (this.pos.x + this.tan.x * Math.sign(v) * 0.08);
    const turnZ = ahead.z - (this.pos.z + this.tan.z * Math.sign(v) * 0.08);
    const k = -6;
    this.derailing = true;
    this.events.push({ type: 'derail', pos: v3(this.pos.x, this.pos.y, this.pos.z) });
    this.goAir(v3(vx + turnX * k * Math.abs(v), 1.2, vz + turnZ * k * Math.abs(v)));
  }

  private goAir(vel: Vec3): void {
    this.mode = 'air';
    this.vel.x = vel.x;
    this.vel.y = vel.y;
    this.vel.z = vel.z;
    this.airTime = 0;
    this.speed = Math.hypot(vel.x, vel.y, vel.z);
  }

  private startHold(dur: number, to: Vec3, then: () => void): void {
    this.mode = 'hold';
    this.hold = { t: 0, dur, from: v3(this.pos.x, this.pos.y, this.pos.z), to, then };
    this.speed = 0;
  }

  private stepHold(dt: number): void {
    const h = this.hold!;
    h.t += dt;
    const k = Math.min(1, h.t / h.dur);
    const e = 1 - (1 - k) * (1 - k);
    this.pos.x = h.from.x + (h.to.x - h.from.x) * e;
    this.pos.y = h.from.y + (h.to.y - h.from.y) * e;
    this.pos.z = h.from.z + (h.to.z - h.from.z) * e;
    if (k >= 1) {
      this.hold = null;
      this.pos.x = h.to.x;
      this.pos.y = h.to.y;
      this.pos.z = h.to.z;
      h.then();
    }
  }

  private stepAir(dt: number): void {
    const p = this.pos;
    const vel = this.vel;
    vel.y -= G * dt;
    p.x += vel.x * dt;
    p.y += vel.y * dt;
    p.z += vel.z * dt;
    this.airTime += dt;
    this.speed = Math.hypot(vel.x, vel.y, vel.z);

    // Catchers (goal funnel, collector, magnet)
    for (const c of this.catchers) {
      const cy = levelY(c.level) + RAIL_Y;
      const dh = Math.hypot(p.x - c.x, p.z - c.z);
      const r = PIECES[c.type].catchRadius!;
      if (dh > r) continue;
      if (c.type === 'magnet') {
        if (Math.abs(p.y - cy) > 0.7 || this.airTime < 0.05) continue;
        const hs = Math.min(MAGNET_MAX, Math.max(MAGNET_MIN, Math.hypot(vel.x, vel.z)));
        this.events.push({ type: 'catch', pos: v3(p.x, p.y, p.z), pieceId: c.id });
        const path = this.board.pathsOf(c.id)[0];
        this.startHold(0.28, v3(c.x, cy, c.z), () => this.enterPath(path, 0.01, hs));
        return;
      }
      if (vel.y > 0 || p.y < cy - 0.2 || p.y > cy + 0.3) continue;
      if (c.type === 'goal') {
        this.events.push({ type: 'catch', pos: v3(p.x, p.y, p.z), pieceId: c.id });
        this.startHold(0.25, v3(c.x, cy, c.z), () => this.win(Math.hypot(vel.x, vel.z)));
        return;
      }
      if (c.type === 'collector') {
        this.events.push({ type: 'catch', pos: v3(p.x, p.y, p.z), pieceId: c.id });
        const path = this.board.pathsOf(c.id)[0];
        this.startHold(0.3, v3(c.x, cy, c.z), () => this.enterPath(path, 0.01, COLLECT_SPEED));
        return;
      }
    }

    // Landing on a rail / crashing into a piece.
    const cx = Math.round(p.x);
    const cz = Math.round(p.z);
    if (this.board.inBounds(cx, cz)) {
      for (const piece of this.board.piecesInColumn(cx, cz)) {
        if (piece.type === 'block') {
          const top = levelY(piece.level + (piece.props.height ?? 1));
          if (p.y - BALL_R < top && p.y + BALL_R > levelY(piece.level) && Math.abs(p.x - cx) < 0.5 && Math.abs(p.z - cz) < 0.5)
            return this.fail('crash');
          continue;
        }
        const recent = piece.id === this.lastPieceId && this.airTime < 0.15;
        if (!recent && vel.y <= 0) {
          for (const path of this.board.pathsOf(piece.id)) {
            const n = nearestOnPath(path, p);
            if (n.dh2 > 0.2 * 0.2) continue;
            const q = v3();
            samplePath(path, n.s, q, this.tan);
            const dy = p.y - q.y;
            if (dy < 0.14 && dy > -0.3) {
              let along = vel.x * this.tan.x + vel.y * this.tan.y + vel.z * this.tan.z;
              along *= 0.88;
              const impact = -vel.y;
              this.derailing = false;
              this.enterPath(path, n.s, along);
              samplePath(path, n.s, this.pos, this.tan);
              this.events.push({ type: 'land', pos: v3(q.x, q.y, q.z), impact });
              return;
            }
          }
        }
        // Solid body of the piece: deck slab per occupied level.
        const base = levelY(piece.level);
        const occTop = base + (PIECES[piece.type].occupancy.length - 1) * LEVEL_H + 0.14;
        if (!recent && p.y - BALL_R < occTop && p.y + BALL_R > base && Math.abs(p.x - cx) < 0.46 && Math.abs(p.z - cz) < 0.46) {
          // Only a crash if we're well below the riding surface.
          let nearRail = false;
          for (const path of this.board.pathsOf(piece.id)) {
            const n = nearestOnPath(path, p);
            if (n.d2 < 0.3 * 0.3) nearRail = true;
          }
          if (!nearRail && p.y < occTop) return this.fail('crash');
        }
      }
    }

    const overHole = !this.board.inBounds(cx, cz) || this.board.isVoid(cx, cz);
    if (!overHole && p.y - BALL_R <= 0) {
      p.y = BALL_R;
      return this.fail(this.derailing ? 'derail' : 'fell');
    }
    if (overHole && p.y < -0.6) return this.fail(this.derailing ? 'derail' : 'fell');
    if (p.y < -4) return this.fail('fell');
  }

  /** After failure: let the sphere tumble on the floor for a moment (visual only). */
  private stepDebris(dt: number): void {
    const p = this.pos;
    const vel = this.vel;
    if (this.speed === 0 && vel.y === 0) return;
    vel.y -= G * dt;
    p.x += vel.x * dt;
    p.y += vel.y * dt;
    p.z += vel.z * dt;
    const cx = Math.round(p.x);
    const cz = Math.round(p.z);
    const hole = !this.board.inBounds(cx, cz) || this.board.isVoid(cx, cz);
    if (!hole && p.y < BALL_R && p.y > -0.2) {
      p.y = BALL_R;
      vel.y = Math.abs(vel.y) > 0.6 ? -vel.y * 0.35 : 0;
      vel.x *= 0.96;
      vel.z *= 0.96;
    }
  }

  private checkMarkers(): void {
    const p = this.pos;
    const shards = this.markers.shards;
    if (shards) {
      for (let i = 0; i < shards.length; i++) {
        if (this.stats.shards[i]) continue;
        const q = shards[i];
        if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 < 0.36 * 0.36) {
          this.stats.shards[i] = true;
          this.events.push({ type: 'shard', pos: v3(q.x, q.y, q.z), index: i });
        }
      }
    }
    const cp = this.markers.checkpoint;
    if (cp && !this.stats.checkpoint && (p.x - cp.x) ** 2 + (p.y - cp.y) ** 2 + (p.z - cp.z) ** 2 < 0.4 * 0.4) {
      this.stats.checkpoint = true;
      this.events.push({ type: 'checkpoint', pos: v3(cp.x, cp.y, cp.z) });
    }
  }

  private win(speed: number): void {
    this.mode = 'won';
    this.stats.goalSpeed = speed;
    this.speed = 0;
    this.events.push({ type: 'win', pos: v3(this.pos.x, this.pos.y, this.pos.z) });
  }

  private fail(reason: FailReason): void {
    if (this.mode === 'rail') {
      // keep momentum for the tumble animation
      this.vel.x = this.tan.x * this.v;
      this.vel.y = 0;
      this.vel.z = this.tan.z * this.v;
      if (reason === 'stalled') this.vel.x = this.vel.z = 0;
    }
    if (reason === 'stalled' || reason === 'timeout') {
      this.vel.x = this.vel.y = this.vel.z = 0;
      this.speed = 0;
    }
    this.mode = 'failed';
    this.failReason = reason;
    this.failTime = 0;
    this.events.push({ type: 'fail', pos: v3(this.pos.x, this.pos.y, this.pos.z), reason });
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export const FAIL_TEXT: Record<FailReason, string> = {
  fell: 'The sphere fell off the track.',
  crash: 'The sphere crashed into a piece.',
  stalled: 'The sphere ran out of energy.',
  derail: 'Too fast for that bend — it flew off!',
  timeout: 'The sphere got lost in the machine.',
};
