import * as THREE from 'three';

/**
 * Visual themes, chosen at build time (VITE_THEME). The portal builds use
 * the default dark "Midnight" look; the GitHub Pages build uses the white
 * "Porcelain" look. Dev builds also accept ?theme=porcelain for testing.
 */
export type ThemeId = 'midnight' | 'porcelain';

export interface Theme {
  id: ThemeId;
  /** Light background: glows use normal blending (additive vanishes on white). */
  light: boolean;
  palette: {
    bgTop: number;
    bgBottom: number;
    skyAccent: number;
    board: number;
    boardRim: number;
    socket: number;
    rail: number;
    tile: number;
    pillar: number;
    block: number;
    blockCap: number;
    pit: number;
    pitGlow: number;
    metal: number;
    floor: number;
    dust: number;
    ghostOk: number;
    ghostBad: number;
    portOpen: number;
    portConnected: number;
    portBlocked: number;
    select: number;
  };
  lights: { hemiSky: number; hemiGround: number; hemi: number; key: number; rim: number; exposure: number };
  fog: [number, number];
  bloom: boolean;
}

const MIDNIGHT: Theme = {
  id: 'midnight',
  light: false,
  palette: {
    bgTop: 0x1a2236,
    bgBottom: 0x07090f,
    skyAccent: 0x24315a,
    board: 0x1b2232,
    boardRim: 0x2a3550,
    socket: 0x252e42,
    rail: 0xc9d2e0,
    tile: 0x2c364c,
    pillar: 0x3a465e,
    block: 0x2c3548,
    blockCap: 0x3b475f,
    pit: 0x030408,
    pitGlow: 0x3b2a6b,
    metal: 0x3a465e,
    floor: 0x121826,
    dust: 0x8aa6ff,
    ghostOk: 0x7dd3fc,
    ghostBad: 0xf87171,
    portOpen: 0xe2e8f0,
    portConnected: 0x4ade80,
    portBlocked: 0xf87171,
    select: 0xfde68a,
  },
  lights: { hemiSky: 0xc4d2ff, hemiGround: 0x262a3a, hemi: 1.2, key: 2.1, rim: 0.9, exposure: 0.92 },
  fog: [28, 70],
  bloom: true,
};

const PORCELAIN: Theme = {
  id: 'porcelain',
  light: true,
  palette: {
    bgTop: 0xf6f8fc,
    bgBottom: 0xdfe5ef,
    skyAccent: 0xffffff,
    board: 0xe8ecf3,
    boardRim: 0xc9d1de,
    socket: 0xf5f7fb,
    rail: 0xffffff,
    tile: 0xdde3ec,
    pillar: 0xc3cbd8,
    block: 0xd3dae5,
    blockCap: 0xe9edf4,
    pit: 0x2a3142,
    pitGlow: 0x8b7fd6,
    metal: 0x9aa6b8,
    floor: 0xd2d9e4,
    dust: 0x9fb2d6,
    ghostOk: 0x0ea5e9,
    ghostBad: 0xef4444,
    portOpen: 0x64748b,
    portConnected: 0x16a34a,
    portBlocked: 0xdc2626,
    select: 0xf59e0b,
  },
  lights: { hemiSky: 0xffffff, hemiGround: 0xb8c2d4, hemi: 1.35, key: 1.9, rim: 0.6, exposure: 0.95 },
  fog: [30, 80],
  bloom: false,
};

function pickTheme(): Theme {
  let id = (import.meta.env.VITE_THEME as string | undefined) ?? 'midnight';
  if (import.meta.env.DEV && typeof location !== 'undefined') id = new URLSearchParams(location.search).get('theme') ?? id;
  return id === 'porcelain' ? PORCELAIN : MIDNIGHT;
}

export const THEME: Theme = pickTheme();

/** Blending for glows, halos and particles. */
export const GLOW_BLENDING: THREE.Blending = THEME.light ? THREE.NormalBlending : THREE.AdditiveBlending;

if (typeof document !== 'undefined') document.documentElement.dataset.theme = THEME.id;
