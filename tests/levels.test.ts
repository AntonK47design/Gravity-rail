import { describe, expect, test } from 'vitest';
import { PIECES } from '../src/core/components';
import { applyPlacements, buildBoard, scoreRun, validateLevel } from '../src/core/level';
import { runHeadless } from '../src/core/runner';
import { LEVELS, WORLDS } from '../src/levels';
import { SHOWCASE } from '../src/levels/showcase';

/**
 * Every level ships with a reference solution. These tests guarantee that
 * each puzzle is solvable with the given inventory, that two and three stars
 * are achievable, that it isn't trivially solved by pressing PLAY, and that
 * the simulation is deterministic.
 */
describe('level catalogue', () => {
  test('has ~30 levels across 5 worlds with unique ids', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    for (const w of WORLDS) expect(LEVELS.filter((l) => l.world === w.index).length).toBeGreaterThanOrEqual(5);
  });
});

for (const level of [...LEVELS, SHOWCASE]) {
  describe(`level ${level.id} "${level.name}"`, () => {
    test('definition is valid', () => {
      expect(validateLevel(level)).toEqual([]);
    });

    test('solution places legally within inventory', () => {
      const board = buildBoard(level);
      const counts = new Map<string, number>();
      for (const p of level.solution) {
        expect(PIECES[p.type].placeable, `${p.type} placeable`).toBe(true);
        expect(board.checkPlacement(p.type, p.at[0], p.at[1], p.at[2]), `place ${p.type} at ${p.at}`).toBeNull();
        applyPlacements(board, [p]);
        counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
      }
      for (const [t, n] of counts) expect(n, `${t} count`).toBeLessThanOrEqual(level.inventory[t as keyof typeof level.inventory] ?? 0);
    });

    test('reference solution reaches the goal within par', () => {
      const r = runHeadless(level, level.solution);
      expect(r.sim.failReason, `fail at ${JSON.stringify(r.sim.pos)}`).toBeNull();
      expect(r.won).toBe(true);
      expect(level.solution.length).toBeLessThanOrEqual(level.par);
    });

    test('three stars are achievable', () => {
      const sol = level.challengeSolution ?? level.solution;
      const board = buildBoard(level);
      const counts = new Map<string, number>();
      for (const p of sol) {
        expect(board.checkPlacement(p.type, p.at[0], p.at[1], p.at[2]), `place ${p.type} at ${p.at}`).toBeNull();
        applyPlacements(board, [p]);
        counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
      }
      for (const [t, n] of counts) expect(n).toBeLessThanOrEqual(level.inventory[t as keyof typeof level.inventory] ?? 0);
      const r = runHeadless(level, sol);
      expect(r.won, `challenge solution fails: ${r.sim.failReason} at ${JSON.stringify(r.sim.pos)}`).toBe(true);
      expect(scoreRun(level, r).stars).toBe(3);
    });

    test('is not solved by an empty board', () => {
      expect(runHeadless(level, []).won).toBe(false);
    });

    test('simulation is deterministic', () => {
      const a = runHeadless(level, level.solution);
      const b = runHeadless(level, level.solution);
      expect(a.stats.time).toBe(b.stats.time);
      expect(a.sim.pos).toEqual(b.sim.pos);
    });
  });
}
