import * as THREE from 'three';
import { Board, Candidate, PlaceError, PlacedPiece, computePorts } from '../core/board';
import { PIECES, PieceType, TOOL_ORDER } from '../core/components';
import { levelY } from '../core/grid';
import { History, Pose } from '../core/history';
import type { LevelDef, Placement } from '../core/level';
import type { BoardView } from '../rendering/BoardView';
import type { Effects } from '../rendering/effects';

export interface BuilderFeedback {
  sound(kind: 'place' | 'remove' | 'rotate' | 'invalid' | 'undo' | 'click'): void;
  toast(text: string, kind?: 'info' | 'bad' | 'hint'): void;
  changed(): void;
}

const ERROR_TEXT: Record<PlaceError, string> = {
  bounds: 'That spot is outside the board.',
  occupied: 'That space is already taken.',
  height: 'Too high — try a lower level.',
  'none-left': 'No more of that component left.',
  fixed: 'Level pieces cannot be moved.',
};

/**
 * Construction interactions: tool selection, smart placement, selection
 * editing and undo. Owns no rendering beyond driving BoardView helpers.
 */
export class Builder {
  tool: PieceType | null = null;
  toolRot = 0;
  selected: number | null = null;
  unlimited = false;
  /** Pieces currently connected to the start (from the circuit trace). */
  energized = new Set<number>();
  private candList: Candidate[] = [];
  private candIdx = 0;
  private candCell = '';
  private hoverNdc: THREE.Vector2 | null = null;
  private ray = new THREE.Raycaster();
  /** A placed piece being carried to a new spot (drag, or the Move button). */
  /** Tool that was armed when a drag started; re-armed after the drop. */
  private resumeTool: PieceType | null = null;
  moving: { id: number; from: Pose & { x: number; z: number }; drag: boolean } | null = null;
  readonly history = new History();

  constructor(
    public board: Board,
    public level: LevelDef,
    private view: BoardView,
    private camera: THREE.Camera,
    private fx: Effects,
    private fb: BuilderFeedback,
  ) {}

  reset(board: Board, level: LevelDef): void {
    this.board = board;
    this.level = level;
    this.tool = null;
    this.selected = null;
    this.moving = null;
    this.view.setCarried(null);
    this.history.clear();
    this.candList = [];
    this.candCell = '';
    this.view.select(null);
    this.view.showGhost(null, null);
  }

  // ---------------------------------------------------------------- inventory

  placedCount(type: PieceType): number {
    let n = 0;
    for (const p of this.board.pieces.values()) if (!p.fixed && p.type === type) n++;
    return n;
  }

  total(type: PieceType): number {
    return this.unlimited ? 99 : (this.level.inventory[type] ?? 0);
  }

  left(type: PieceType): number {
    return this.total(type) - this.placedCount(type);
  }

  tools(): { type: PieceType; left: number; total: number }[] {
    const types = this.unlimited ? TOOL_ORDER : TOOL_ORDER.filter((t) => (this.level.inventory[t] ?? 0) > 0);
    return types.map((type) => ({ type, left: this.left(type), total: this.total(type) }));
  }

  usedCount(): number {
    return this.board.playerPieces().length;
  }

  placements(): Placement[] {
    return this.board.playerPieces().map((p) => ({
      type: p.type,
      at: [p.x, p.z, p.level],
      rot: p.rot,
      ...(p.props.state !== undefined ? { state: p.props.state } : {}),
    }));
  }

  /** Restores a saved build, silently skipping anything no longer valid. */
  restore(placements: Placement[]): void {
    for (const p of placements) {
      if (!PIECES[p.type]?.placeable || this.left(p.type) <= 0) continue;
      if (this.board.checkPlacement(p.type, p.at[0], p.at[1], p.at[2])) continue;
      this.board.add({ type: p.type, x: p.at[0], z: p.at[1], level: p.at[2], rot: ((p.rot % 4) + 4) % 4, fixed: false, props: p.state !== undefined ? { state: p.state } : {} });
    }
  }

  // ---------------------------------------------------------------- tools

  setTool(t: PieceType | null): void {
    if (t) this.cancelMove(true);
    if (t && this.left(t) <= 0) {
      this.fb.sound('invalid');
      this.fb.toast(`No ${PIECES[t].name} left — remove one to reuse it.`, 'bad');
      return;
    }
    this.tool = t;
    this.candCell = '';
    if (t) this.select(null);
    this.refreshHover();
  }

  // ---------------------------------------------------------------- picking

  private setRay(ndc: THREE.Vector2): void {
    this.ray.setFromCamera(ndc, this.camera);
  }

  pickPiece(ndc: THREE.Vector2): number | null {
    this.setRay(ndc);
    const hits = this.ray.intersectObjects(this.view.pickables, true);
    for (const h of hits) {
      const id = this.view.pieceIdFromObject(h.object);
      if (id !== null && this.board.pieces.has(id)) return id;
    }
    return null;
  }

  /**
   * Smart placement: intersect the pointer ray with every level plane and
   * keep the best-scoring candidate. Aiming next to an elevated rail end
   * therefore snaps to that height automatically.
   */
  /** The piece type currently previewed: the carried piece, or the toolbar tool. */
  private activeType(): PieceType | null {
    if (this.moving) return this.board.pieces.get(this.moving.id)?.type ?? null;
    return this.tool;
  }

  private pickCandidate(ndc: THREE.Vector2): { best: Candidate | null; list: Candidate[]; cell: string } {
    const tool = this.activeType()!;
    const ignore = this.moving?.id;
    this.setRay(ndc);
    let best: Candidate | null = null;
    let bestList: Candidate[] = [];
    let floorCell: [number, number] | null = null;
    const hit = new THREE.Vector3();
    for (let L = 0; L <= this.board.maxLevel; L++) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(levelY(L) + 0.05));
      if (!this.ray.ray.intersectPlane(plane, hit)) continue;
      const cx = Math.round(hit.x);
      const cz = Math.round(hit.z);
      if (L === 0) floorCell = [cx, cz];
      if (!this.board.inBounds(cx, cz)) continue;
      const list = this.board
        .candidates(tool, cx, cz, L, this.toolRot, ignore, this.energized)
        .filter((c) => c.level <= L && c.level >= L - 2)
        .map((c) => ({ ...c, score: c.score - (c.connections === 0 ? c.level * 3 : 0) }));
      list.sort((a, b) => b.score - a.score);
      const top = list[0];
      if (top && (!best || top.score > best.score + 1e-6)) {
        best = top;
        bestList = list.filter((c) => c.x === top.x && c.z === top.z);
      }
    }
    if (!best && floorCell) {
      const [cx, cz] = floorCell;
      const c = this.board.evaluate(tool, cx, cz, 0, this.toolRot, ignore);
      if (!this.board.inBounds(cx, cz)) {
        c.valid = false;
        c.error = 'bounds';
      } else if (c.valid) {
        c.valid = false;
        c.error = 'occupied';
      }
      return { best: c, list: [], cell: `${cx},${cz},x` };
    }
    if (best && !this.moving && this.left(tool) <= 0) best = { ...best, valid: false, error: 'none-left' };
    return { best, list: bestList, cell: best ? `${best.x},${best.z}` : '' };
  }

  hover(ndc: THREE.Vector2 | null): void {
    this.hoverNdc = ndc;
    this.refreshHover();
  }

  refreshHover(): void {
    const type = this.activeType();
    if (!type || !this.hoverNdc) {
      this.view.showGhost(null, null);
      return;
    }
    const { best, list, cell } = this.pickCandidate(this.hoverNdc);
    if (cell !== this.candCell) {
      this.candCell = cell;
      this.candIdx = 0;
      this.candList = list;
    } else if (list.length) {
      // Board may have changed: keep the cycled choice if it still exists.
      const cur = this.candList[this.candIdx];
      this.candList = list;
      const idx = cur ? list.findIndex((c) => c.level === cur.level && c.rot === cur.rot) : -1;
      this.candIdx = idx >= 0 ? idx : 0;
    }
    const c = this.candList.length ? this.candList[this.candIdx] : best;
    this.view.showGhost(type, c ?? null);
  }

  private currentCandidate(ndc: THREE.Vector2, touch: boolean): Candidate | null {
    if (touch || !this.hoverNdc) {
      const { best, list } = this.pickCandidate(ndc);
      this.candList = list;
      this.candIdx = 0;
      return best;
    }
    this.hover(ndc);
    return this.candList.length ? this.candList[this.candIdx] : this.pickCandidate(ndc).best;
  }

  // ---------------------------------------------------------------- tap

  tap(ndc: THREE.Vector2, touch: boolean): void {
    if (this.moving) {
      // Tap-to-drop (after pressing Move).
      const c = this.currentCandidate(ndc, touch);
      if (c?.valid) this.commitMove(c);
      else {
        this.fb.sound('invalid');
        this.fb.toast(c?.error ? ERROR_TEXT[c.error] : 'Pick a free spot — Esc cancels the move.', 'bad');
      }
      return;
    }
    const hitId = this.pickPiece(ndc);
    if (this.tool) {
      if (touch && hitId !== null) {
        this.select(hitId, true);
        return;
      }
      const c = this.currentCandidate(ndc, touch);
      if (c && c.valid) {
        this.place(this.tool, c, touch);
        return;
      }
      if (hitId !== null) {
        this.select(hitId);
        return;
      }
      if (c?.error) {
        this.fb.sound('invalid');
        this.fb.toast(ERROR_TEXT[c.error], 'bad');
      }
      return;
    }
    if (hitId !== null) {
      const p = this.board.pieces.get(hitId)!;
      if (this.selected === hitId && p.type === 'splitter' && !p.fixed) this.flip();
      else this.select(hitId);
    } else this.select(null);
  }

  private place(type: PieceType, c: Candidate, selectAfter: boolean): void {
    const piece = this.board.add({ type, x: c.x, z: c.z, level: c.level, rot: c.rot, fixed: false, props: {} });
    this.history.push({ kind: 'place', piece });
    this.toolRot = c.rot;
    this.fb.sound('place');
    const centre = { x: c.x, y: levelY(c.level) + 0.2, z: c.z };
    this.fx.burst(centre, PIECES[type].color, 14, 1.6, 0.1, 0.5, 0.8);
    this.fx.ring({ x: c.x, y: levelY(c.level) + 0.12, z: c.z }, PIECES[type].color, 1.2, 0.45);
    for (const port of c.ports) if (port.status === 'connected') this.fx.burst(port.pos, 0x4ade80, 6, 0.8, 0.08, 0.4);
    this.candCell = '';
    if (this.left(type) <= 0) this.tool = null;
    // Touch: keep the tool armed for rapid tapping; the bubble edits the piece just placed.
    if (selectAfter) this.select(piece.id, true);
    this.fb.changed();
    this.refreshHover();
  }

  // ---------------------------------------------------------------- selection editing

  select(id: number | null, keepTool = false): void {
    this.selected = id;
    this.view.select(id);
    if (id !== null && !keepTool) {
      this.tool = null;
      this.view.showGhost(null, null);
    }
    this.fb.changed();
  }

  selectedPiece(): PlacedPiece | null {
    return this.selected !== null ? (this.board.pieces.get(this.selected) ?? null) : null;
  }

  private portSig(p: Pick<PlacedPiece, 'type' | 'x' | 'z' | 'level' | 'rot'>): string {
    return computePorts(p)
      .map((q) => q.key)
      .sort()
      .join('|');
  }

  /** R: cycles placement candidates while placing, or rotates the selected piece. */
  rotate(): void {
    if (this.moving || (this.tool && (this.selected === null || this.hoverNdc))) {
      if (this.candList.length > 1) {
        this.candIdx = (this.candIdx + 1) % this.candList.length;
        this.toolRot = this.candList[this.candIdx].rot;
      } else this.toolRot = (this.toolRot + 1) % 4;
      if (!this.candList.length) this.candCell = '';
      this.fb.sound('rotate');
      this.refreshHover();
      return;
    }
    this.rotatePiece();
  }

  /** Rotates the selected piece in place (skipping rotations that change nothing). */
  rotatePiece(): void {
    const p = this.selectedPiece();
    if (!p || p.fixed) return;
    const directional = !['track', 'gate', 'switch', 'brake', 'ramp', 'curve', 'drop', 'splitter'].includes(p.type);
    const sig = this.portSig(p);
    for (let k = 1; k < 4; k++) {
      const rot = (p.rot + k) % 4;
      if (!directional && this.portSig({ ...p, rot }) === sig) continue;
      this.history.push({ kind: 'move', id: p.id, from: { level: p.level, rot: p.rot }, to: { level: p.level, rot } });
      this.board.update(p.id, { rot });
      this.fb.sound('rotate');
      this.fb.changed();
      return;
    }
  }

  raise(dir: number): void {
    const p = this.selectedPiece();
    if (!p || p.fixed) return;
    const level = p.level + dir;
    const err = this.board.checkPlacement(p.type, p.x, p.z, level, p.props, p.id);
    if (err) {
      this.fb.sound('invalid');
      this.fb.toast(level < 0 ? 'Already on the board.' : ERROR_TEXT[err], 'bad');
      return;
    }
    this.history.push({ kind: 'move', id: p.id, from: { level: p.level, rot: p.rot }, to: { level, rot: p.rot } });
    this.board.update(p.id, { level });
    this.fb.sound('rotate');
    this.fb.changed();
  }

  // ---------------------------------------------------------------- moving

  /** Can a drag starting here pick up a piece? (Build mode, no tool armed, on a player piece.) */
  canGrab(ndc: THREE.Vector2): boolean {
    // Works even with a tool armed: pressing on a placed piece and dragging moves it.
    if (this.moving) return false;
    const id = this.pickPiece(ndc);
    return id !== null && !this.board.pieces.get(id)!.fixed;
  }

  /** Pick up a placed piece; its ghost follows the pointer until dropped. */
  startMove(id: number | null = this.selected, drag = false, ndc?: THREE.Vector2): void {
    const p = id !== null ? this.board.pieces.get(id) : undefined;
    if (!p) return;
    if (p.fixed) {
      this.fb.sound('invalid');
      this.fb.toast(ERROR_TEXT.fixed, 'bad');
      return;
    }
    this.resumeTool = this.tool;
    this.select(null);
    this.tool = null;
    this.moving = { id: p.id, from: { x: p.x, z: p.z, level: p.level, rot: p.rot }, drag };
    this.view.setCarried(p.id);
    this.toolRot = p.rot;
    this.candCell = '';
    this.candList = [];
    this.fb.sound('click');
    if (!drag) this.fb.toast('Moving — click a new spot (R rotates, Esc cancels).', 'info');
    if (ndc) this.hoverNdc = ndc;
    this.fb.changed();
    this.refreshHover();
  }

  dragTo(ndc: THREE.Vector2): void {
    if (this.moving) this.hover(ndc);
  }

  /** Release after a drag: drop if the spot is valid, otherwise snap back. */
  endDrag(ndc: THREE.Vector2): void {
    if (!this.moving) return;
    if (Number.isNaN(ndc.x)) return this.cancelMove();
    this.hover(ndc);
    const c = this.candList.length ? this.candList[this.candIdx] : this.pickCandidate(ndc).best;
    if (c?.valid) this.commitMove(c);
    else {
      this.fb.sound('invalid');
      if (c?.error) this.fb.toast(ERROR_TEXT[c.error], 'bad');
      this.cancelMove(true);
    }
  }

  private commitMove(c: Candidate): void {
    const m = this.moving!;
    const p = this.board.pieces.get(m.id);
    this.moving = null;
    this.view.setCarried(null);
    this.view.showGhost(null, null);
    if (!p) return;
    const to = { x: c.x, z: c.z, level: c.level, rot: c.rot };
    const f = m.from;
    if (to.x !== f.x || to.z !== f.z || to.level !== f.level || to.rot !== f.rot) {
      this.history.push({ kind: 'move', id: p.id, from: f, to });
      this.board.update(p.id, to);
      this.fx.burst({ x: c.x, y: levelY(c.level) + 0.2, z: c.z }, PIECES[p.type].color, 12, 1.4, 0.1, 0.45, 0.8);
      for (const port of c.ports) if (port.status === 'connected') this.fx.burst(port.pos, 0x4ade80, 6, 0.8, 0.08, 0.4);
      this.fb.sound('place');
    }
    this.finishMove(p.id);
  }

  /** After a move: re-arm the previous tool if there was one, else select the moved piece. */
  private finishMove(id: number | null): void {
    const tool = this.resumeTool;
    this.resumeTool = null;
    if (tool && this.left(tool) > 0) {
      this.tool = tool;
      this.selected = null;
      this.view.select(null);
      this.candCell = '';
      this.fb.changed();
      this.refreshHover();
    } else this.select(id);
  }

  cancelMove(quiet = false): void {
    if (!this.moving) return;
    const id = this.moving.id;
    this.moving = null;
    this.view.setCarried(null);
    this.view.showGhost(null, null);
    if (!quiet) this.fb.sound('undo');
    this.finishMove(this.board.pieces.has(id) ? id : null);
  }

  flip(): void {
    const p = this.selectedPiece();
    if (!p || p.fixed || p.type !== 'splitter') return;
    const from = p.props.state ?? 0;
    p.props.state = 1 - from;
    this.board.version++;
    this.history.push({ kind: 'toggle', id: p.id, from, to: p.props.state });
    this.fb.sound('rotate');
    this.fb.changed();
  }

  remove(): void {
    const p = this.selectedPiece();
    if (!p) return;
    if (p.fixed) {
      this.fb.sound('invalid');
      this.fb.toast(ERROR_TEXT.fixed, 'bad');
      return;
    }
    this.board.remove(p.id);
    this.history.push({ kind: 'remove', piece: p });
    this.fx.burst({ x: p.x, y: levelY(p.level) + 0.2, z: p.z }, 0x94a3b8, 10, 1.2, 0.08, 0.4);
    this.fb.sound('remove');
    this.select(null);
  }

  undo(): void {
    this.cancelMove(true);
    const a = this.history.undo(this.board);
    if (!a) {
      this.fb.sound('invalid');
      return;
    }
    this.fb.sound('undo');
    if (this.selected !== null && !this.board.pieces.has(this.selected)) this.select(null);
    this.candCell = '';
    this.fb.changed();
    this.refreshHover();
  }

  clear(): void {
    this.cancelMove(true);
    const removed = this.board.clearPlayerPieces();
    if (!removed.length) return;
    this.history.push({ kind: 'clear', pieces: removed });
    this.select(null);
    this.fb.sound('remove');
    this.fb.changed();
  }
}
