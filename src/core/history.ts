import { Board, PlacedPiece } from './board';

export type Action =
  | { kind: 'place'; piece: PlacedPiece }
  | { kind: 'remove'; piece: PlacedPiece }
  | { kind: 'move'; id: number; from: { level: number; rot: number }; to: { level: number; rot: number } }
  | { kind: 'toggle'; id: number; from: number; to: number }
  | { kind: 'clear'; pieces: PlacedPiece[] };

const clone = (p: PlacedPiece): PlacedPiece => ({ ...p, props: { ...p.props } });

/** Undo stack for construction actions. */
export class History {
  private stack: Action[] = [];

  push(a: Action): void {
    if (a.kind === 'place' || a.kind === 'remove') a = { ...a, piece: clone(a.piece) };
    if (a.kind === 'clear') a = { ...a, pieces: a.pieces.map(clone) };
    this.stack.push(a);
    if (this.stack.length > 200) this.stack.shift();
  }

  get size(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack = [];
  }

  /** Reverts the last action. Returns it (for feedback) or null. */
  undo(board: Board): Action | null {
    const a = this.stack.pop();
    if (!a) return null;
    switch (a.kind) {
      case 'place':
        board.remove(a.piece.id);
        break;
      case 'remove':
        board.add(clone(a.piece));
        break;
      case 'move':
        board.update(a.id, a.from);
        break;
      case 'toggle': {
        const p = board.pieces.get(a.id);
        if (p) {
          p.props.state = a.from;
          board.version++;
        }
        break;
      }
      case 'clear':
        for (const p of a.pieces) board.add(clone(p));
        break;
    }
    return a;
  }
}
