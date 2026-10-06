import { PieceType } from './components';
import { LevelDef, Placement, RunResult, applyPlacements, buildBoard, levelMarkers } from './level';
import { SIM_DT, Simulation } from './simulation';

/** Runs a level headlessly with the given placements. Used by tests and debug tools. */
export function runHeadless(level: LevelDef, placements: Placement[], maxTime = 70): RunResult & { sim: Simulation } {
  const board = buildBoard(level);
  applyPlacements(board, placements);
  const sim = new Simulation(board, levelMarkers(level), level.start.speed);
  const steps = Math.ceil(maxTime / SIM_DT);
  for (let i = 0; i < steps && sim.mode !== 'won' && sim.mode !== 'failed'; i++) sim.step();
  const typesUsed = new Set<PieceType>(placements.map((p) => p.type));
  return { won: sim.mode === 'won', stats: sim.stats, piecesUsed: placements.length, typesUsed, sim };
}
