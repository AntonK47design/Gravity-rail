import type { LevelDef } from '../core/level';
import { WORLD1 } from './world1';
import { WORLD2 } from './world2';
import { WORLD3 } from './world3';
import { WORLD4 } from './world4';
import { WORLD5 } from './world5';

export interface WorldDef {
  index: number;
  name: string;
  desc: string;
}

export const WORLDS: WorldDef[] = [
  { index: 1, name: 'Foundations', desc: 'Rails, slopes and bends. Learn how the sphere moves.' },
  { index: 2, name: 'Momentum', desc: 'Height is energy. Drops, kickers and gaps.' },
  { index: 3, name: 'Machines', desc: 'Boosters, brakes, switches and gates. Timing matters.' },
  { index: 4, name: 'Energy', desc: 'Portals, launchers, magnets and collectors.' },
  { index: 5, name: 'Mastermind', desc: 'Everything at once. Few parts, big machines.' },
];

/** Level data lives in plain modules — adding a level never touches game logic. */
export const LEVELS: LevelDef[] = [...WORLD1, ...WORLD2, ...WORLD3, ...WORLD4, ...WORLD5];

export function levelCode(level: LevelDef): string {
  const inWorld = LEVELS.filter((l) => l.world === level.world);
  return `${level.world}-${inWorld.indexOf(level) + 1}`;
}
