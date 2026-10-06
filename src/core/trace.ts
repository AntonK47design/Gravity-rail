import { Board, PlacedPiece } from './board';

export interface TraceResult {
  /** Pieces reachable by rolling along connected rails from the start. */
  energized: Set<number>;
  /** True if the rail network connects start → goal without leaving the track. */
  complete: boolean;
}

/**
 * Static connectivity walk (no physics): follows ports from the start piece.
 * Used for build-mode feedback only — the simulation is the authority.
 * Splitters follow their current branch; air pieces (launcher, kicker,
 * portals) count as "energized" but end the walk unless a landing is implied.
 */
export function traceFromStart(board: Board): TraceResult {
  const energized = new Set<number>();
  let start: PlacedPiece | undefined;
  for (const p of board.pieces.values()) if (p.type === 'start') start = p;
  if (!start) return { energized, complete: false };

  let piece: PlacedPiece | undefined = start;
  let enteredPort = -1;
  let complete = false;
  for (let guard = 0; guard < 400 && piece; guard++) {
    energized.add(piece.id);
    if (piece.type === 'goal') {
      complete = true;
      break;
    }
    const paths = board.pathsOf(piece.id);
    // Choose the path we travel and the port we leave from.
    let exitPort = -1;
    if (enteredPort < 0) {
      const p0 = paths[0];
      exitPort = 'port' in p0.b ? p0.b.port : -1;
    } else {
      const candidates = paths.filter((p) => ('port' in p.a && p.a.port === enteredPort) || ('port' in p.b && p.b.port === enteredPort));
      let path = candidates[0];
      if (candidates.length > 1) path = candidates.find((c) => c.branch === (piece!.props.state ?? 0)) ?? candidates[0];
      if (!path) break;
      const other = 'port' in path.a && path.a.port === enteredPort ? path.b : path.a;
      if (!('port' in other)) {
        if (other.terminal === 'teleport') {
          const twin = [...board.pieces.values()].find((q) => q.id !== piece!.id && q.type === 'teleporter' && (q.props.channel ?? 0) === (piece!.props.channel ?? 0));
          if (twin && !energized.has(twin.id)) {
            piece = twin;
            energized.add(twin.id);
            exitPort = 0;
          } else break;
        } else break;
      } else exitPort = other.port;
    }
    if (exitPort < 0) break;
    const port = board.portsOf(piece.id)[exitPort];
    const partner = port && board.partnerPort(port);
    if (!partner) break;
    const next = board.pieces.get(partner.pieceId);
    if (!next || (energized.has(next.id) && next.type !== 'goal')) break;
    piece = next;
    enteredPort = partner.index;
  }
  return { energized, complete };
}
