/** Cosmetic sphere skins. Purely visual — physics never changes. */
export interface Skin {
  id: string;
  name: string;
  blurb: string;
  price: number;
  /** Shell colour and its glow. */
  color: number;
  glow: number;
  /** Halo / light / trail colour. */
  trail: number;
  glowIntensity: number;
  metalness: number;
  roughness: number;
  /** Trail length multiplier (1 = default). */
  trailLength: number;
  /** Cycle the hue over time (rainbow). */
  hueCycle?: boolean;
  /** Wireframe cage colour/opacity over the shell. */
  cage: number;
  cageOpacity: number;
}

export const SKINS: Skin[] = [
  { id: 'spark', name: 'Spark', blurb: 'The original energy sphere.', price: 0, color: 0x9ff3ff, glow: 0x9ff3ff, trail: 0x6fe6ff, glowIntensity: 1, metalness: 0.1, roughness: 0.15, trailLength: 1, cage: 0xffffff, cageOpacity: 0.25 },
  { id: 'rose', name: 'Rose', blurb: 'A soft pink glow.', price: 120, color: 0xffb3d9, glow: 0xff7ab8, trail: 0xff8fc7, glowIntensity: 1, metalness: 0.1, roughness: 0.2, trailLength: 1, cage: 0xffffff, cageOpacity: 0.2 },
  { id: 'volt', name: 'Volt', blurb: 'Electric lime, crackling with charge.', price: 180, color: 0xd9ff7a, glow: 0xa3ff2b, trail: 0xb6ff4d, glowIntensity: 1.1, metalness: 0.1, roughness: 0.2, trailLength: 1.2, cage: 0xf7ffd6, cageOpacity: 0.35 },
  { id: 'ember', name: 'Ember', blurb: 'Glowing coal with a trail of fire.', price: 250, color: 0xffa36b, glow: 0xff5a1f, trail: 0xff7a2e, glowIntensity: 1.2, metalness: 0.05, roughness: 0.35, trailLength: 1.5, cage: 0xffd2a8, cageOpacity: 0.3 },
  { id: 'gilded', name: 'Gilded', blurb: 'Polished gold. Pure luxury.', price: 400, color: 0xffd36b, glow: 0xffb000, trail: 0xffd36b, glowIntensity: 0.45, metalness: 0.9, roughness: 0.22, trailLength: 1, cage: 0xfff1c2, cageOpacity: 0.15 },
  { id: 'void', name: 'Void', blurb: 'A dark core wrapped in violet light.', price: 500, color: 0x1b1030, glow: 0x7c3aed, trail: 0xa78bfa, glowIntensity: 0.9, metalness: 0.4, roughness: 0.3, trailLength: 1.3, cage: 0xc4b5fd, cageOpacity: 0.55 },
  { id: 'comet', name: 'Comet', blurb: 'Ice-white, with a long streak behind it.', price: 650, color: 0xf2f8ff, glow: 0xdbeafe, trail: 0xbfdbfe, glowIntensity: 1, metalness: 0.2, roughness: 0.1, trailLength: 2.4, cage: 0x93c5fd, cageOpacity: 0.3 },
  { id: 'prism', name: 'Prism', blurb: 'Every colour at once.', price: 900, color: 0xffffff, glow: 0xff00ff, trail: 0xffffff, glowIntensity: 1, metalness: 0.2, roughness: 0.1, trailLength: 1.8, hueCycle: true, cage: 0xffffff, cageOpacity: 0.35 },
];

export const DEFAULT_SKIN = 'spark';

export function skinById(id: string | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
