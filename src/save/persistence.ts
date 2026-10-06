import type { Placement } from '../core/level';
import type { Quality } from '../rendering/Renderer';

export interface LevelRecord {
  stars: number;
  bestTime: number | null;
  completed: boolean;
  /** Last construction, restored when the level is reopened. */
  build?: Placement[];
}

export interface Settings {
  music: number;
  sfx: number;
  muted: boolean;
  quality: Quality | 'auto';
  follow: boolean;
  shake: boolean;
  hints: boolean;
}

export interface SaveData {
  version: 1;
  levels: Record<string, LevelRecord>;
  settings: Settings;
  seenIntro: boolean;
}

const KEY = 'orbital.save.v1';

export const DEFAULT_SETTINGS: Settings = {
  music: 0.6,
  sfx: 0.85,
  muted: false,
  quality: 'auto',
  follow: true,
  shake: true,
  hints: true,
};

function fresh(): SaveData {
  return { version: 1, levels: {}, settings: { ...DEFAULT_SETTINGS }, seenIntro: false };
}

/**
 * Local persistence. Falls back to memory when storage is unavailable
 * (private mode, sandboxed iframes) — the game keeps working, progress just
 * won't survive a reload.
 */
export class Persistence {
  data: SaveData;
  private available: boolean;
  private timer: number | null = null;

  constructor() {
    this.available = Persistence.probe();
    this.data = this.load();
  }

  private static probe(): boolean {
    try {
      const k = '__orbital_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  get storageAvailable(): boolean {
    return this.available;
  }

  private load(): SaveData {
    if (!this.available) return fresh();
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (!parsed || parsed.version !== 1) return fresh();
      return {
        version: 1,
        levels: typeof parsed.levels === 'object' && parsed.levels ? parsed.levels : {},
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        seenIntro: !!parsed.seenIntro,
      };
    } catch {
      return fresh();
    }
  }

  /** Debounced write. */
  save(): void {
    if (!this.available) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (!this.available) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Quota or permission error — keep running in memory.
    }
  }

  level(id: string): LevelRecord {
    return this.data.levels[id] ?? { stars: 0, bestTime: null, completed: false };
  }

  recordResult(id: string, stars: number, time: number): { newBest: boolean; prevStars: number } {
    const rec = this.level(id);
    const prevStars = rec.stars;
    const newBest = rec.bestTime === null || time < rec.bestTime;
    this.data.levels[id] = {
      ...rec,
      completed: true,
      stars: Math.max(rec.stars, stars),
      bestTime: newBest ? time : rec.bestTime,
    };
    this.save();
    return { newBest, prevStars };
  }

  storeBuild(id: string, build: Placement[]): void {
    const rec = this.level(id);
    this.data.levels[id] = { ...rec, build };
    this.save();
  }

  reset(): void {
    const settings = this.data.settings;
    this.data = fresh();
    this.data.settings = settings;
    this.flush();
  }

  totalStars(): number {
    return Object.values(this.data.levels).reduce((s, r) => s + (r.stars || 0), 0);
  }
}
