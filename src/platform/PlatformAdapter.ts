/**
 * Platform abstraction. The game only ever talks to this interface; SDK
 * specifics (CrazyGames, Playgama, …) live in their own adapters and are
 * never required for the core game to run.
 */
export interface PlatformAdapter {
  readonly name: string;
  init(): Promise<void>;
  loadingStart(): void;
  loadingStop(): void;
  /** Player is actively playing (building or running a machine). */
  gameplayStart(): void;
  /** Player is in a menu / paused / between levels. */
  gameplayStop(): void;
  /** A celebratory moment (e.g. three-star solve). */
  happyTime(): void;
  /**
   * Natural break between levels. Resolves when it is safe to continue.
   * `pause`/`resume` let the game mute audio while an ad is shown.
   */
  commercialBreak(pause: () => void, resume: () => void): Promise<void>;
  /** Platform wants the game muted/unmuted (optional). */
  onAudioChange?(cb: (muted: boolean) => void): void;
}

export class LocalPlatform implements PlatformAdapter {
  readonly name = 'local';
  async init(): Promise<void> {}
  loadingStart(): void {}
  loadingStop(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  happyTime(): void {}
  async commercialBreak(): Promise<void> {}
}

/** Loads an external SDK script with a timeout. Never throws. */
export function loadScript(src: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      const t = window.setTimeout(() => resolve(false), timeoutMs);
      s.onload = () => {
        window.clearTimeout(t);
        resolve(true);
      };
      s.onerror = () => {
        window.clearTimeout(t);
        resolve(false);
      };
      document.head.appendChild(s);
    } catch {
      resolve(false);
    }
  });
}
