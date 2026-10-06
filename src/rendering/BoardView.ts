import * as THREE from 'three';
import { GLOW_BLENDING } from './theme';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Board, Candidate, PlacedPiece } from '../core/board';
import { CHANNEL_COLORS, PIECES, PieceType } from '../core/components';
import { LEVEL_H, RAIL_Y, Vec3, levelY } from '../core/grid';
import { G, Simulation, gateOpenAt, launcherVelocity } from '../core/simulation';
import { PALETTE, additiveMat, ghostMaterial, glowMat, glowTexture, stdMat } from './materials';
import { PieceAnim, buildPieceModel } from './pieceMeshes';

interface PieceObj {
  piece: PlacedPiece;
  root: THREE.Group;
  anim: PieceAnim;
  appear: number;
  flash: number;
  rot: number;
  level: number;
}

const ROT = (r: number) => (-r * Math.PI) / 2;

/** Keeps three.js objects in sync with a Board and renders build-mode helpers. */
export class BoardView {
  readonly root = new THREE.Group();
  private base = new THREE.Group();
  private objs = new Map<number, PieceObj>();
  private dying: { root: THREE.Group; t: number }[] = [];
  private pillars: THREE.InstancedMesh | null = null;
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private portDots: THREE.Mesh[] = [];
  private guide: THREE.Mesh;
  private cellHi: THREE.Mesh;
  private selection: THREE.Group;
  private selectedId: number | null = null;
  private arcs = new THREE.Group();
  private debugPaths: THREE.Group | null = null;
  private debugLabels: THREE.Group | null = null;
  private shards: THREE.Mesh[] = [];
  private checkpoint: THREE.Group | null = null;
  private lastVersion = -1;
  private t = 0;
  private board: Board | null = null;
  buildMode = true;
  private energized = new Set<number>();
  private circuitComplete = false;
  private carried: number | null = null;
  private guides = new THREE.Group();
  private guideGeo = new THREE.PlaneGeometry(0.8, 0.8);
  private guideMat = additiveMat(PALETTE.ghostOk, 0.25);

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.root.add(this.base, this.arcs, this.guides);

    this.guide = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), additiveMat(PALETTE.ghostOk, 0.5));
    this.guide.visible = false;
    this.root.add(this.guide);

    this.cellHi = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), additiveMat(PALETTE.ghostOk, 0.18));
    this.cellHi.rotation.x = -Math.PI / 2;
    this.cellHi.visible = false;
    this.root.add(this.cellHi);

    this.selection = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.select });
    const barX = new THREE.BoxGeometry(0.2, 0.03, 0.04);
    const barZ = new THREE.BoxGeometry(0.04, 0.03, 0.2);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const a = new THREE.Mesh(barX, mat);
      a.position.set(sx * 0.42, 0, sz * 0.5);
      const b = new THREE.Mesh(barZ, mat);
      b.position.set(sx * 0.5, 0, sz * 0.42);
      this.selection.add(a, b);
    }
    this.selection.visible = false;
    this.root.add(this.selection);
  }

  get pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const o of this.objs.values()) out.push(o.root);
    return out;
  }

  pieceIdFromObject(o: THREE.Object3D | null): number | null {
    while (o) {
      if (o.userData.pieceId !== undefined) return o.userData.pieceId as number;
      o = o.parent;
    }
    return null;
  }

  /** Builds the board plate for a new level. */
  setLevel(board: Board, shards: Vec3[] = [], checkpoint?: Vec3): void {
    this.board = board;
    for (const o of this.objs.values()) this.root.remove(o.root);
    this.objs.clear();
    this.base.clear();
    this.lastVersion = -1;
    const { width: w, depth: d } = board;

    const plate = new THREE.Mesh(new RoundedBoxGeometry(w + 0.5, 0.5, d + 0.5, 3, 0.12), stdMat(PALETTE.board, { rough: 0.85 }));
    plate.position.set((w - 1) / 2, -0.25, (d - 1) / 2);
    plate.receiveShadow = true;
    this.base.add(plate);
    const rim = new THREE.Mesh(new RoundedBoxGeometry(w + 0.62, 0.12, d + 0.62, 2, 0.05), stdMat(PALETTE.boardRim, { rough: 0.5, metal: 0.2 }));
    rim.position.set((w - 1) / 2, -0.44, (d - 1) / 2);
    this.base.add(rim);

    const voidCount = board.voids.size;
    const socket = new THREE.InstancedMesh(new RoundedBoxGeometry(0.9, 0.02, 0.9, 1, 0.008), stdMat(PALETTE.socket, { rough: 0.9 }), w * d - voidCount);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) if (!board.isVoid(x, z)) socket.setMatrixAt(i++, m.makeTranslation(x, 0.0, z));
    if (voidCount) {
      const pit = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.04, 1.0), new THREE.MeshBasicMaterial({ color: PALETTE.pit }), voidCount);
      const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.98, 0.98), additiveMat(PALETTE.pitGlow, 0.25), voidCount);
      let j = 0;
      for (const key of board.voids) {
        const [vx, vz] = key.split(',').map(Number);
        pit.setMatrixAt(j, m.makeTranslation(vx, 0.0, vz));
        glow.setMatrixAt(j, new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(vx, 0.025, vz));
        j++;
      }
      this.base.add(pit, glow);
    }
    socket.receiveShadow = true;
    this.base.add(socket);

    // Shards & checkpoint
    this.shards = shards.map((p) => {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), glowMat(0xf0abfc, 1.6));
      s.position.set(p.x, p.y, p.z);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xf0abfc, transparent: true, opacity: 0.6, depthWrite: false, blending: GLOW_BLENDING }));
      halo.scale.setScalar(0.6);
      s.add(halo);
      this.base.add(s);
      return s;
    });
    this.checkpoint = null;
    if (checkpoint) {
      const g = new THREE.Group();
      g.position.set(checkpoint.x, checkpoint.y, checkpoint.z);
      const mat = glowMat(0xfef3c7, 1.2);
      const r1 = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 40), mat);
      const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 40), mat);
      r2.rotation.y = Math.PI / 2;
      g.add(r1, r2);
      this.base.add(g);
      this.checkpoint = g;
    }
    this.sync();
  }

  bounds(): THREE.Box3 {
    const b = this.board;
    if (!b) return new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(5, 1, 5));
    let maxY = 0.5;
    for (const p of b.pieces.values()) maxY = Math.max(maxY, levelY(p.level + 1));
    return new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(b.width - 0.5, maxY, b.depth - 0.5));
  }

  sync(): void {
    const board = this.board;
    if (!board || board.version === this.lastVersion) return;
    this.lastVersion = board.version;
    // Remove
    for (const [id, o] of this.objs) {
      const p = board.pieces.get(id);
      if (!p || p.type !== o.piece.type) {
        this.dying.push({ root: o.root, t: 0 });
        this.objs.delete(id);
      }
    }
    // Add / update
    for (const p of board.pieces.values()) {
      let o = this.objs.get(p.id);
      if (!o) {
        const { group, anim } = buildPieceModel(p.type, { channel: p.props.channel, height: p.props.height });
        group.userData.pieceId = p.id;
        this.root.add(group);
        o = { piece: p, root: group, anim, appear: p.fixed ? 1 : 0, flash: 0, rot: p.rot, level: p.level };
        this.objs.set(p.id, o);
      }
      o.piece = p;
      o.root.visible = p.id !== this.carried;
      if (o.rot !== p.rot || o.level !== p.level || o.root.position.x !== p.x || o.root.position.z !== p.z) {
        o.appear = Math.min(o.appear, 0.5);
        o.rot = p.rot;
        o.level = p.level;
      }
      o.root.position.set(p.x, levelY(p.level), p.z);
      o.root.rotation.y = ROT(p.rot);
    }
    this.rebuildPillars();
    this.rebuildArcs();
    if (this.debugPaths) this.showPaths(true);
  }

  private rebuildPillars(): void {
    const board = this.board!;
    const items: { x: number; z: number; y0: number; y1: number }[] = [];
    for (const p of board.pieces.values()) {
      if (p.level === 0 || p.type === 'block') continue;
      const y1 = levelY(p.level) + 0.02;
      const y0 = board.supportBase(p.x, p.z, p.level);
      if (y1 - y0 > 0.05) items.push({ x: p.x, z: p.z, y0, y1 });
    }
    if (this.pillars) {
      this.root.remove(this.pillars);
      this.pillars.dispose();
    }
    if (!items.length) {
      this.pillars = null;
      return;
    }
    const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 1, 12), stdMat(PALETTE.pillar, { rough: 0.6, metal: 0.2 }), items.length);
    const m = new THREE.Matrix4();
    items.forEach((it, i) => {
      m.makeScale(1, it.y1 - it.y0, 1);
      m.setPosition(it.x, (it.y0 + it.y1) / 2, it.z);
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.pillars = inst;
    this.root.add(inst);
  }

  private rebuildArcs(): void {
    this.arcs.clear();
    if (!this.board) return;
    for (const p of this.board.pieces.values()) if (p.type === 'launcher') this.arcs.add(this.makeArc(p, 0xfb923c));
  }

  private makeArc(p: Pick<PlacedPiece, 'x' | 'z' | 'level' | 'rot'>, color: number): THREE.Points {
    const vel = launcherVelocity(p as PlacedPiece);
    const y0 = levelY(p.level) + RAIL_Y;
    const pts: number[] = [];
    for (let t = 0.05; t < 2.2; t += 0.05) {
      const y = y0 + vel.y * t - 0.5 * G * t * t;
      if (y < y0 - 1.5) break;
      pts.push(p.x + vel.x * t, y, p.z + vel.z * t);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.16, map: glowTexture(), transparent: true, opacity: 0.95, depthWrite: false, blending: GLOW_BLENDING }));
  }

  // ---------------------------------------------------------------- ghost

  showGhost(type: PieceType | null, c: Candidate | null): void {
    if (!type || !c) {
      if (this.ghost) this.ghost.visible = false;
      this.portDots.forEach((d) => (d.visible = false));
      this.guide.visible = false;
      this.cellHi.visible = false;
      return;
    }
    const key = `${type}:${c.valid}`;
    if (!this.ghost || this.ghostKey !== key) {
      if (this.ghost) this.root.remove(this.ghost);
      const { group } = buildPieceModel(type);
      const mat = ghostMaterial(c.valid);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = mat;
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      if (type === 'launcher') group.add(this.makeArc({ x: 0, z: 0, level: 0, rot: 0 }, 0x7dd3fc));
      this.ghost = group;
      this.ghostKey = key;
      this.root.add(group);
    }
    this.ghost.visible = true;
    const targetPos = new THREE.Vector3(c.x, levelY(c.level), c.z);
    if (this.ghost.position.distanceTo(targetPos) > 2) this.ghost.position.copy(targetPos);
    this.ghost.userData.target = targetPos;
    this.ghost.rotation.y = ROT(c.rot);
    // Arc child is built in local space at rot 0 — counter its rotation by rebuilding as needed.
    // Port indicators
    while (this.portDots.length < c.ports.length) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: PALETTE.portOpen }));
      this.portDots.push(d);
      this.root.add(d);
    }
    this.portDots.forEach((d, i) => {
      const port = c.ports[i];
      d.visible = !!port;
      if (!port) return;
      d.position.set(port.pos.x, port.pos.y, port.pos.z);
      (d.material as THREE.MeshBasicMaterial).color.set(
        port.status === 'connected' ? PALETTE.portConnected : port.status === 'blocked' ? PALETTE.portBlocked : PALETTE.portOpen,
      );
    });
    const top = levelY(c.level);
    this.guide.visible = c.level > 0;
    this.guide.scale.y = Math.max(0.01, top);
    this.guide.position.set(c.x, top / 2, c.z);
    this.cellHi.visible = true;
    this.cellHi.position.set(c.x, 0.03, c.z);
    ((this.cellHi.material as THREE.MeshBasicMaterial).color as THREE.Color).set(c.valid ? PALETTE.ghostOk : PALETTE.ghostBad);
  }

  /** Pieces connected to the start glow softly — the circuit "comes alive" while building. */
  setEnergized(ids: Set<number>, complete: boolean): void {
    this.energized = ids;
    this.circuitComplete = complete;
  }

  /** Onboarding: faint pulsing target cells. */
  setGuides(cells: { x: number; z: number; level: number }[]): void {
    this.guides.clear();
    for (const c of cells) {
      const m = new THREE.Mesh(this.guideGeo, this.guideMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(c.x, levelY(c.level) + 0.13, c.z);
      this.guides.add(m);
    }
  }

  /** Hide the piece being carried (its ghost shows where it will land). */
  setCarried(id: number | null): void {
    this.carried = id;
    for (const o of this.objs.values()) o.root.visible = o.piece.id !== id;
  }

  select(id: number | null): void {
    this.selectedId = id;
  }

  flash(id: number): void {
    const o = this.objs.get(id);
    if (o) o.flash = 1;
  }

  markShard(i: number, collected: boolean): void {
    if (this.shards[i]) this.shards[i].visible = !collected;
  }

  resetMarkers(): void {
    this.shards.forEach((s) => (s.visible = true));
  }

  // ---------------------------------------------------------------- debug

  showPaths(on: boolean): void {
    if (this.debugPaths) this.root.remove(this.debugPaths);
    this.debugPaths = null;
    if (!on || !this.board) return;
    const g = new THREE.Group();
    for (const p of this.board.pieces.values()) {
      for (const path of this.board.pathsOf(p.id)) {
        const geo = new THREE.BufferGeometry().setFromPoints(path.pts.map((q) => new THREE.Vector3(q.x, q.y, q.z)));
        g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff00ff, depthTest: false })));
      }
      for (const port of this.board.portsOf(p.id)) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.04), new THREE.MeshBasicMaterial({ color: this.board.partnerPort(port) ? 0x00ff00 : 0xffff00, depthTest: false }));
        s.position.set(port.pos.x, port.pos.y, port.pos.z);
        g.add(s);
      }
      const r = PIECES[p.type].catchRadius;
      if (r) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.02, r, 40), new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide, depthTest: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p.x, levelY(p.level) + RAIL_Y, p.z);
        g.add(ring);
      }
    }
    g.renderOrder = 999;
    this.debugPaths = g;
    this.root.add(g);
  }

  showCoords(on: boolean): void {
    if (this.debugLabels) this.root.remove(this.debugLabels);
    this.debugLabels = null;
    if (!on || !this.board) return;
    const g = new THREE.Group();
    for (let x = 0; x < this.board.width; x++) {
      for (let z = 0; z < this.board.depth; z++) {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 32;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${x},${z}`, 32, 22);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
        s.scale.set(0.5, 0.25, 1);
        s.position.set(x, 0.05, z + 0.3);
        g.add(s);
      }
    }
    this.debugLabels = g;
    this.root.add(g);
  }

  // ---------------------------------------------------------------- frame

  update(dt: number, sim: Simulation | null): void {
    this.t += dt;
    const t = this.t;
    for (const o of this.objs.values()) {
      if (o.appear < 1) {
        o.appear = Math.min(1, o.appear + dt * 4.5);
        const k = o.appear;
        const s = 1 + Math.sin(k * Math.PI) * 0.12 * (1 - k) - (1 - k) * 0.35;
        o.root.scale.setScalar(s);
        o.root.position.y = levelY(o.piece.level) + (1 - k) * (1 - k) * 0.35;
      } else if (o.root.scale.x !== 1) o.root.scale.setScalar(1);
      if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 2.5);
      if (o.anim.plate) {
        const on = this.energized.has(o.piece.id) && o.piece.type !== 'block';
        const target = on ? (this.circuitComplete ? 0.2 + Math.sin(t * 3 - o.piece.x - o.piece.z) * 0.06 : 0.1) : 0;
        o.anim.plate.emissiveIntensity += (target - o.anim.plate.emissiveIntensity) * Math.min(1, dt * 6);
      }
      this.animatePiece(o, sim, t);
    }
    for (const d of this.dying) {
      d.t += dt * 6;
      d.root.scale.setScalar(Math.max(0.01, 1 - d.t));
      if (d.t >= 1) this.root.remove(d.root);
    }
    this.dying = this.dying.filter((d) => d.t < 1);

    if (this.ghost?.visible && this.ghost.userData.target) {
      this.ghost.position.lerp(this.ghost.userData.target as THREE.Vector3, 1 - Math.exp(-dt * 25));
      const pulse = 0.85 + Math.sin(t * 5) * 0.15;
      this.ghost.scale.setScalar(pulse * 0.04 + 0.97);
    }

    const sel = this.selectedId !== null ? this.objs.get(this.selectedId) : undefined;
    this.selection.visible = !!sel && this.buildMode;
    if (sel) {
      this.selection.position.set(sel.piece.x, levelY(sel.piece.level) + 0.12, sel.piece.z);
      this.selection.scale.setScalar(1 + Math.sin(t * 4) * 0.03);
    }
    this.arcs.visible = this.buildMode;
    this.guides.visible = this.buildMode;
    this.guideMat.opacity = 0.18 + (Math.sin(t * 4) + 1) * 0.14;

    this.shards.forEach((s, i) => {
      s.rotation.y = t * 1.5 + i;
      s.position.y += Math.sin(t * 2 + i) * 0.0008;
    });
    if (this.checkpoint) {
      this.checkpoint.rotation.y = t * 0.8;
      this.checkpoint.rotation.x = Math.sin(t * 0.7) * 0.3;
    }
  }

  private animatePiece(o: PieceObj, sim: Simulation | null, t: number): void {
    const p = o.piece;
    const a = o.anim;
    switch (p.type) {
      case 'gate':
      case 'timer': {
        const open = sim ? sim.isGateOpen(p) : p.type === 'timer' ? gateOpenAt(p, t) : (p.props.state ?? 0) === 1;
        const ty = open ? RAIL_Y - 0.34 : RAIL_Y + 0.02;
        if (a.bar) a.bar.position.y += (ty - a.bar.position.y) * Math.min(1, 0.016 * 18);
        if (a.glow) a.glow.emissiveIntensity = open ? 0.25 : 1.1 + o.flash;
        if (a.timerRing) {
          const period = p.props.period ?? 2;
          const ph = ((((sim ? sim.time : t) + (p.props.phase ?? 0)) % period) + period) % period / period;
          a.timerRing.rotation.z = -ph * Math.PI * 2;
          (a.timerRing.material as THREE.MeshBasicMaterial).opacity = open ? 0.7 : 0.2;
        }
        break;
      }
      case 'booster':
        a.chevrons?.forEach((m, i) => {
          const k = (Math.sin(t * 8 - i * 1.2) + 1) / 2;
          m.emissiveIntensity = 0.3 + k * 1.4 + o.flash * 2;
        });
        break;
      case 'switch':
        if (a.glow) a.glow.emissiveIntensity = 0.5 + o.flash * 3;
        if (a.button) a.button.position.y = RAIL_Y - 0.15 - o.flash * 0.03;
        break;
      case 'splitter': {
        const branch = sim ? sim.splitterBranch(p) : (p.props.state ?? 0);
        const target = branch === 0 ? 0.55 : -0.55;
        if (a.flipper) a.flipper.rotation.y += (target - a.flipper.rotation.y) * 0.2;
        break;
      }
      case 'teleporter':
        if (a.spin) a.spin.rotation.x = t * 2;
        if (a.glow) a.glow.emissiveIntensity = 1 + Math.sin(t * 3) * 0.3 + o.flash * 2;
        break;
      case 'magnet':
        if (a.spin) a.spin.rotation.y = Math.sin(t * 1.5) * 0.3;
        break;
      case 'goal':
        if (a.spin) a.spin.rotation.y = t * 0.8;
        if (a.glow) a.glow.emissiveIntensity = 0.8 + Math.sin(t * 2.5) * 0.2 + o.flash * 3;
        if (a.beam) (a.beam.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(t * 2) * 0.05 + o.flash * 0.4;
        break;
      case 'start':
        if (a.glow) a.glow.emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.25;
        break;
      case 'launcher':
        if (a.glow) a.glow.emissiveIntensity = 0.6 + o.flash * 3;
        break;
    }
  }

  channelColor(ch: number | undefined): number {
    return CHANNEL_COLORS[(ch ?? 0) % CHANNEL_COLORS.length];
  }

  /** Screen-space anchor for UI bubbles. */
  pieceWorldPos(id: number): THREE.Vector3 | null {
    const o = this.objs.get(id);
    if (!o) return null;
    return new THREE.Vector3(o.piece.x, levelY(o.piece.level) + LEVEL_H + 0.3, o.piece.z);
  }
}
