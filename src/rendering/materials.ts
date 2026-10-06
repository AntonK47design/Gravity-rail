import * as THREE from 'three';

/** Shared palette + material cache. All pieces reuse these to keep draw state small. */
export const PALETTE = {
  bgTop: 0x1a2236,
  bgBottom: 0x07090f,
  board: 0x1b2232,
  boardEdge: 0x0f1420,
  socket: 0x252e42,
  socketLine: 0x2a3550,
  rail: 0xc9d2e0,
  railDark: 0xb7c2d4,
  tile: 0x2c364c,
  pillar: 0x3a465e,
  ball: 0x9ff3ff,
  ballCore: 0xffffff,
  ghostOk: 0x7dd3fc,
  ghostBad: 0xf87171,
  portOpen: 0xe2e8f0,
  portConnected: 0x4ade80,
  portBlocked: 0xf87171,
  select: 0xfde68a,
};

const cache = new Map<string, THREE.Material>();

export function stdMat(color: number, opts: { rough?: number; metal?: number; emissive?: number; emissiveIntensity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `std:${color}:${opts.rough ?? 0.55}:${opts.metal ?? 0.05}:${opts.emissive ?? 0}:${opts.emissiveIntensity ?? 0}`;
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.55,
      metalness: opts.metal ?? 0.05,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    });
    cache.set(key, m);
  }
  return m;
}

/** Unshared emissive material (for things that animate their glow). */
export function glowMat(color: number, intensity = 1.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
}

export function additiveMat(color: number, opacity = 0.5): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

let glowTex: THREE.Texture | null = null;
/** Soft radial gradient used for glow sprites and particles. */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export function ghostMaterial(ok: boolean): THREE.MeshBasicMaterial {
  const key = `ghost:${ok}`;
  let m = cache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: ok ? PALETTE.ghostOk : PALETTE.ghostBad,
      transparent: true,
      opacity: ok ? 0.42 : 0.35,
      depthWrite: false,
    });
    cache.set(key, m);
  }
  return m;
}
