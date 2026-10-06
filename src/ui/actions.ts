import type { PieceType } from '../core/components';
import type { Settings } from '../save/persistence';

/** Everything the UI can ask the game to do. Implemented by Game. */
export interface UIActions {
  continueGame(): void;
  openLevels(): void;
  startLevel(index: number): void;
  backToMenu(): void;
  selectTool(t: PieceType | null): void;
  undo(): void;
  resetBuild(): void;
  togglePlay(): void;
  toggleSpeed(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  rotateSelected(): void;
  moveSelected(): void;
  raiseSelected(dir: number): void;
  flipSelected(): void;
  removeSelected(): void;
  deselect(): void;
  hint(): void;
  toggleMute(): void;
  resetCamera(): void;
  nextLevel(): void;
  replay(): void;
  settingsChanged(s: Settings): void;
  resetProgress(): void;
  uiSound(kind: 'hover' | 'click'): void;
}
