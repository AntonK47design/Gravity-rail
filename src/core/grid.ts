/**
 * Grid conventions.
 *
 * - A cell (x, z) is centred on world (x, 0, z) and is 1 unit wide.
 * - Vertical "levels" are LEVEL_H units apart. Level 0 sits on the board.
 * - Directions: 0 = +X (east), 1 = +Z (south), 2 = -X (west), 3 = -Z (north).
 * - A piece rotation r maps local direction d to world direction (d + r) % 4.
 */

export const LEVEL_H = 0.5;
/** Height of the ball centre above a level plane when resting on a deck. */
export const RAIL_Y = 0.28;
export const BALL_R = 0.16;

export type Dir = 0 | 1 | 2 | 3;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const DIR_VEC: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function rotDir(d: number, rot: number): Dir {
  return ((((d + rot) % 4) + 4) % 4) as Dir;
}

export function oppositeDir(d: number): Dir {
  return ((d + 2) % 4) as Dir;
}

/** Rotate a local XZ offset by rot * 90deg (maps +X to +Z for rot=1). */
export function rotXZ(x: number, z: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 0:
      return [x, z];
    case 1:
      return [-z, x];
    case 2:
      return [-x, -z];
    default:
      return [z, -x];
  }
}

export function voxelKey(x: number, level: number, z: number): string {
  return `${x},${level},${z}`;
}

export function levelY(level: number): number {
  return level * LEVEL_H;
}

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
