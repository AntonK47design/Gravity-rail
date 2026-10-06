import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CHANNEL_COLORS, PIECES, PieceType } from '../core/components';
import { LEVEL_H, RAIL_Y, Vec3 } from '../core/grid';
import { PALETTE, additiveMat, glowMat, stdMat } from './materials';

/**
 * Procedural piece models. Every rail-carrying piece shares the same swept
 * channel profile so the whole machine reads as one construction set.
 * Geometries are cached per type; groups are cheap wrappers around them.
 */

export interface PieceAnim {
  bar?: THREE.Object3D;
  chevrons?: THREE.MeshStandardMaterial[];
  spin?: THREE.Object3D;
  flipper?: THREE.Object3D;
  button?: THREE.Object3D;
  glow?: THREE.MeshStandardMaterial;
  channelMats?: THREE.MeshStandardMaterial[];
  beam?: THREE.Mesh;
  timerRing?: THREE.Mesh;
  branchMats?: THREE.MeshStandardMaterial[];
  plate?: THREE.MeshStandardMaterial;
}

const PROFILE: [number, number][] = [
  [-0.22, -0.25],
  [0.22, -0.25],
  [0.22, -0.07],
  [0.16, -0.07],
  [0.16, -0.165],
  [-0.16, -0.165],
  [-0.16, -0.07],
  [-0.22, -0.07],
];

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Sweep a closed 2D profile (u = right, v = up) along a polyline. */
export function sweep(pts: Vec3[], profile: [number, number][] = PROFILE): THREE.BufferGeometry {
  const n = pts.length;
  const m = profile.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const T = new THREE.Vector3();
  const L = new THREE.Vector3(0, 0, 1);
  const N = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const frames: { P: THREE.Vector3; L: THREE.Vector3; N: THREE.Vector3 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    T.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    const l = new THREE.Vector3().crossVectors(T, up);
    if (l.lengthSq() > 1e-4) L.copy(l.normalize());
    N.crossVectors(L, T).normalize();
    frames.push({ P: new THREE.Vector3(pts[i].x, pts[i].y, pts[i].z), L: L.clone(), N: N.clone() });
  }
  // Sides: each profile edge gets its own vertex strip for crisp creases.
  for (let j = 0; j < m; j++) {
    const [u0, v0] = profile[j];
    const [u1, v1] = profile[(j + 1) % m];
    const nu = v1 - v0;
    const nv = -(u1 - u0);
    const len = Math.hypot(nu, nv) || 1;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const f = frames[i];
      for (const [u, v] of [
        [u0, v0],
        [u1, v1],
      ]) {
        pos.push(f.P.x + f.L.x * u + f.N.x * v, f.P.y + f.L.y * u + f.N.y * v, f.P.z + f.L.z * u + f.N.z * v);
        nor.push((f.L.x * nu + f.N.x * nv) / len, (f.L.y * nu + f.N.y * nv) / len, (f.L.z * nu + f.N.z * nv) / len);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      const b = base + (i + 1) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // End caps
  const contour = profile.map(([u, v]) => new THREE.Vector2(u, v));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const end of [0, n - 1]) {
    const f = frames[end];
    const T2 = new THREE.Vector3().crossVectors(f.N, f.L).multiplyScalar(end === 0 ? 1 : -1);
    const base = pos.length / 3;
    for (const [u, v] of profile) {
      pos.push(f.P.x + f.L.x * u + f.N.x * v, f.P.y + f.L.y * u + f.N.y * v, f.P.z + f.L.z * u + f.N.z * v);
      nor.push(T2.x, T2.y, T2.z);
    }
    for (const t of tris) {
      if (end === 0) idx.push(base + t[0], base + t[2], base + t[1]);
      else idx.push(base + t[0], base + t[1], base + t[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const tileGeo = () => cached('tile', () => new RoundedBoxGeometry(0.92, 0.1, 0.92, 2, 0.035));
const plateGeo = () => cached('plate', () => new RoundedBoxGeometry(0.74, 0.03, 0.74, 2, 0.012));

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

function addTile(group: THREE.Group, color: number, y = 0): THREE.MeshStandardMaterial {
  const t = mesh(tileGeo(), stdMat(PALETTE.tile, { rough: 0.7 }));
  t.position.y = y + 0.045;
  group.add(t);
  const plateMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05, emissive: color, emissiveIntensity: 0 });
  const p = mesh(plateGeo(), plateMat, false);
  p.position.y = y + 0.082;
  group.add(p);
  return plateMat;
}

function channel(type: PieceType, index: number, mat?: THREE.Material): THREE.Mesh {
  const def = PIECES[type];
  const geo = cached(`ch:${type}:${index}`, () => sweep(def.paths[index].pts));
  return mesh(geo, mat ?? stdMat(PALETTE.rail, { rough: 0.32, metal: 0.05 }));
}

function chevronGeo(): THREE.BufferGeometry {
  return cached('chevron', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.06, -0.11);
    s.lineTo(0.05, 0);
    s.lineTo(-0.06, 0.11);
    s.lineTo(-0.11, 0.11);
    s.lineTo(-0.0, 0);
    s.lineTo(-0.11, -0.11);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.015, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  });
}

let beamTex: THREE.Texture | null = null;
function beamTexture(): THREE.Texture {
  if (beamTex) return beamTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#000');
  grd.addColorStop(0.7, '#555');
  grd.addColorStop(1, '#fff');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 64);
  beamTex = new THREE.CanvasTexture(c);
  return beamTex;
}

export interface PieceModelOpts {
  channel?: number;
  height?: number;
}

/** Builds the model for a piece at rot 0, base level plane at y = 0. */
export function buildPieceModel(type: PieceType, opts: PieceModelOpts = {}): { group: THREE.Group; anim: PieceAnim } {
  const def = PIECES[type];
  const group = new THREE.Group();
  const anim: PieceAnim = {};
  const chColor = CHANNEL_COLORS[(opts.channel ?? 0) % CHANNEL_COLORS.length];

  if (type === 'block') {
    const h = Math.max(1, opts.height ?? 1) * LEVEL_H;
    const g = cached(`block:${h}`, () => new RoundedBoxGeometry(0.9, h, 0.9, 2, 0.05));
    const b = mesh(g, stdMat(0x2c3548, { rough: 0.8 }));
    b.position.y = h / 2;
    group.add(b);
    const cap = mesh(cached('blockcap', () => new RoundedBoxGeometry(0.7, 0.03, 0.7, 2, 0.01)), stdMat(0x3b475f, { rough: 0.6 }), false);
    cap.position.y = h + 0.01;
    group.add(cap);
    return { group, anim };
  }

  anim.plate = addTile(group, def.color);
  def.paths.forEach((_, i) => {
    if (type === 'splitter') {
      const m = stdMat(PALETTE.rail, { rough: 0.32 }).clone();
      anim.branchMats = anim.branchMats ?? [];
      anim.branchMats.push(m);
      group.add(channel(type, i, m));
    } else group.add(channel(type, i));
  });

  switch (type) {
    case 'ramp': {
      const p = mesh(cached('rampPost', () => new THREE.CylinderGeometry(0.05, 0.06, LEVEL_H + 0.05, 10)), stdMat(PALETTE.pillar));
      p.position.set(-0.34, (LEVEL_H + 0.05) / 2 + 0.05, 0);
      group.add(p);
      break;
    }
    case 'drop': {
      const tube = new THREE.Mesh(
        cached('dropTube', () => new THREE.CylinderGeometry(0.27, 0.27, LEVEL_H * 2 + 0.2, 20, 1, true)),
        new THREE.MeshStandardMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.16, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
      );
      tube.position.y = LEVEL_H + 0.35;
      group.add(tube);
      for (const y of [0.35, LEVEL_H + 0.35, LEVEL_H * 2 + 0.38]) {
        const ring = mesh(cached('dropRing', () => new THREE.TorusGeometry(0.27, 0.025, 8, 24)), stdMat(def.color, { rough: 0.4 }), false);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        group.add(ring);
      }
      break;
    }
    case 'kicker': {
      for (const s of [-1, 1]) {
        const fin = mesh(cached('fin', () => new THREE.BoxGeometry(0.42, 0.18, 0.03)), stdMat(def.color, { rough: 0.45 }));
        fin.position.set(0.12, 0.2, s * 0.235);
        fin.rotation.z = 0.32;
        group.add(fin);
      }
      break;
    }
    case 'booster': {
      anim.chevrons = [];
      for (let i = 0; i < 3; i++) {
        const mat = glowMat(def.color, 0.4);
        const c = new THREE.Mesh(chevronGeo(), mat);
        c.position.set(-0.22 + i * 0.2, RAIL_Y - 0.155, 0);
        group.add(c);
        anim.chevrons.push(mat);
      }
      break;
    }
    case 'brake': {
      for (const s of [-1, 1]) {
        const pad = mesh(cached('brakePad', () => new THREE.BoxGeometry(0.6, 0.06, 0.05)), stdMat(def.color, { rough: 0.8 }));
        pad.position.set(0, RAIL_Y - 0.05, s * 0.185);
        group.add(pad);
      }
      for (let i = 0; i < 4; i++) {
        const stripe = mesh(cached('brakeStripe', () => new THREE.BoxGeometry(0.05, 0.012, 0.3)), stdMat(def.color, { rough: 0.7 }), false);
        stripe.position.set(-0.27 + i * 0.18, RAIL_Y - 0.16, 0);
        group.add(stripe);
      }
      break;
    }
    case 'gate':
    case 'timer': {
      const color = type === 'timer' ? def.color : chColor;
      for (const s of [-1, 1]) {
        const post = mesh(cached('gatePost', () => new RoundedBoxGeometry(0.08, 0.56, 0.08, 1, 0.02)), stdMat(0x3a465e, { rough: 0.5 }));
        post.position.set(0, 0.36, s * 0.27);
        group.add(post);
      }
      const barMat = glowMat(color, 0.9);
      const bar = mesh(cached('gateBar', () => new RoundedBoxGeometry(0.07, 0.24, 0.48, 1, 0.02)), barMat);
      bar.position.set(0, RAIL_Y + 0.02, 0);
      group.add(bar);
      anim.bar = bar;
      anim.glow = barMat;
      if (type === 'timer') {
        const ring = new THREE.Mesh(cached('timerRing', () => new THREE.RingGeometry(0.3, 0.36, 40, 1, 0, Math.PI * 2)), additiveMat(color, 0.6));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.11;
        group.add(ring);
        anim.timerRing = ring;
      }
      break;
    }
    case 'switch': {
      const buttonMat = glowMat(chColor, 0.6);
      const button = mesh(cached('switchBtn', () => new THREE.CylinderGeometry(0.11, 0.12, 0.05, 20)), buttonMat);
      button.position.set(0, RAIL_Y - 0.15, 0);
      group.add(button);
      anim.button = button;
      anim.glow = buttonMat;
      const ring = mesh(cached('switchRing', () => new THREE.TorusGeometry(0.33, 0.02, 6, 32)), stdMat(chColor, { rough: 0.4 }), false);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.12;
      group.add(ring);
      break;
    }
    case 'splitter': {
      const pivot = new THREE.Group();
      pivot.position.set(-0.12, RAIL_Y - 0.1, 0);
      const paddle = mesh(cached('paddle', () => new RoundedBoxGeometry(0.3, 0.1, 0.04, 1, 0.015)), glowMat(def.color, 0.5));
      paddle.position.x = 0.15;
      pivot.add(paddle);
      group.add(pivot);
      anim.flipper = pivot;
      break;
    }
    case 'teleporter': {
      const spin = new THREE.Group();
      spin.position.set(0, RAIL_Y + 0.05, 0);
      const ringMat = glowMat(chColor === CHANNEL_COLORS[0] ? def.color : chColor, 1.2);
      const ring = mesh(cached('portalRing', () => new THREE.TorusGeometry(0.27, 0.045, 10, 36)), ringMat);
      ring.rotation.y = Math.PI / 2;
      spin.add(ring);
      const disc = new THREE.Mesh(cached('portalDisc', () => new THREE.CircleGeometry(0.25, 32)), additiveMat(def.color, 0.35));
      disc.rotation.y = Math.PI / 2;
      spin.add(disc);
      group.add(spin);
      anim.spin = spin;
      anim.glow = ringMat;
      const back = mesh(cached('portalBack', () => new RoundedBoxGeometry(0.12, 0.34, 0.46, 1, 0.03)), stdMat(0x2b2350, { rough: 0.5 }));
      back.position.set(0.3, 0.27, 0);
      group.add(back);
      break;
    }
    case 'launcher': {
      const cradle = mesh(cached('cradle', () => new RoundedBoxGeometry(0.42, 0.16, 0.5, 2, 0.04)), stdMat(def.color, { rough: 0.45 }));
      cradle.position.set(0.08, 0.17, 0);
      group.add(cradle);
      const barrel = mesh(cached('barrel', () => new THREE.CylinderGeometry(0.11, 0.14, 0.32, 18, 1, true)), stdMat(0x3a465e, { rough: 0.4 }));
      barrel.position.set(0.18, 0.4, 0);
      barrel.rotation.z = -0.82;
      group.add(barrel);
      const glow = glowMat(def.color, 0.6);
      const ring = mesh(cached('barrelRing', () => new THREE.TorusGeometry(0.13, 0.025, 8, 24)), glow);
      ring.position.set(0.3, 0.51, 0);
      ring.rotation.y = Math.PI / 2;
      ring.rotation.x = 0.82;
      group.add(ring);
      anim.glow = glow;
      break;
    }
    case 'magnet': {
      const spin = new THREE.Group();
      spin.position.y = 0.5;
      const glow = glowMat(def.color, 0.8);
      const u = mesh(cached('magU', () => new THREE.TorusGeometry(0.17, 0.06, 10, 24, Math.PI)), stdMat(0xd84b4b, { rough: 0.4 }));
      u.rotation.z = Math.PI;
      spin.add(u);
      for (const s of [-1, 1]) {
        const tip = mesh(cached('magTip', () => new THREE.CylinderGeometry(0.062, 0.062, 0.08, 14)), stdMat(0xe2e8f0, { rough: 0.3 }));
        tip.position.set(s * 0.17, 0.04, 0);
        spin.add(tip);
      }
      group.add(spin);
      anim.spin = spin;
      const post = mesh(cached('magPost', () => new THREE.CylinderGeometry(0.04, 0.05, 0.4, 10)), stdMat(PALETTE.pillar));
      post.position.set(-0.2, 0.3, 0);
      group.add(post);
      const field = new THREE.Mesh(cached('magField', () => new THREE.RingGeometry(1.18, 1.25, 64)), additiveMat(def.color, 0.18));
      field.rotation.x = -Math.PI / 2;
      field.position.y = RAIL_Y;
      group.add(field);
      anim.glow = glow;
      break;
    }
    case 'collector': {
      const pts = [new THREE.Vector2(0.12, 0), new THREE.Vector2(0.18, 0.08), new THREE.Vector2(0.44, 0.3), new THREE.Vector2(0.46, 0.33)];
      const cone = mesh(cached('funnel', () => new THREE.LatheGeometry(pts, 28)), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.4, side: THREE.DoubleSide }));
      cone.position.y = RAIL_Y - 0.12;
      group.add(cone);
      break;
    }
    case 'goal': {
      const glow = glowMat(0xfde68a, 1.4);
      const spin = new THREE.Group();
      spin.position.set(0, RAIL_Y, 0);
      const ring = mesh(cached('goalRing', () => new THREE.TorusGeometry(0.34, 0.045, 10, 40)), glow);
      ring.rotation.x = Math.PI / 2;
      spin.add(ring);
      const ring2 = mesh(cached('goalRing2', () => new THREE.TorusGeometry(0.25, 0.02, 8, 32)), glow);
      ring2.rotation.x = Math.PI / 2;
      ring2.position.y = 0.12;
      spin.add(ring2);
      group.add(spin);
      anim.spin = spin;
      anim.glow = glow;
      const cup = mesh(cached('goalCup', () => new THREE.CylinderGeometry(0.2, 0.14, 0.06, 24)), stdMat(0xfff3c4, { rough: 0.3, emissive: 0xfde68a, emissiveIntensity: 0.6 }), false);
      cup.position.y = RAIL_Y - 0.19;
      group.add(cup);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.35, alphaMap: beamTexture(), blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(cached('beam', () => new THREE.CylinderGeometry(0.2, 0.3, 3.2, 24, 1, true)), beamMat);
      beam.position.y = RAIL_Y + 1.6;
      group.add(beam);
      anim.beam = beam;
      break;
    }
    case 'start': {
      const wall = mesh(cached('startWall', () => new RoundedBoxGeometry(0.14, 0.42, 0.56, 2, 0.04)), stdMat(0xdbe4f0, { rough: 0.35 }));
      wall.position.set(-0.3, 0.3, 0);
      group.add(wall);
      const glow = glowMat(0x9ff3ff, 1.4);
      const ring = mesh(cached('startRing', () => new THREE.TorusGeometry(0.22, 0.03, 8, 32)), glow);
      ring.position.set(-0.22, RAIL_Y + 0.02, 0);
      ring.rotation.y = Math.PI / 2;
      group.add(ring);
      anim.glow = glow;
      break;
    }
  }
  return { group, anim };
}
