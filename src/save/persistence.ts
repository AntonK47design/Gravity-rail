import type { Placement } from '../core/level';
import type { Quality } from '../rendering/Renderer';
import { DailyState, REWARD } from '../meta/economy';
import { DEFAULT_SKIN } from '../meta/skins';

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
  /** Gears balance. */
  coins: number;
  /** Owned skin ids. */
  skins: string[];
  /** Equipped skin id. */
  skin: string;
  daily: DailyState;
}

const KEY = 'gravityrail.save.v1';
/** Saves from before the rename (when the game was called ORBITAL). */
const LEGACY_KEYS = ['orbital.save.v1'];

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
  return { version: 1, levels: {}, settings: { ...DEFAULT_SETTINGS }, seenIntro: false, coins: 0, skins: [DEFAULT_SKIN], skin: DEFAULT_SKIN, daily: { last: null, streak: 0 } };
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
      const k = '__gravityrail_probe__';
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
      let raw = window.localStorage.getItem(KEY);
      for (const k of LEGACY_KEYS) if (!raw) raw = window.localStorage.getItem(k);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (!parsed || parsed.version !== 1) return fresh();
      const levels: Record<string, LevelRecord> = typeof parsed.levels === 'object' && parsed.levels ? parsed.levels : {};
      // Saves from before the shop existed get the Gears they would have earned.
      const earned = Object.values(levels).reduce((n, r) => n + (r.completed ? REWARD.firstClear : 0) + (r.stars || 0) * REWARD.perStar, 0);
      const skins = Array.isArray(parsed.skins) ? parsed.skins.filter((x): x is string => typeof x === 'string') : [];
      if (!skins.includes(DEFAULT_SKIN)) skins.unshift(DEFAULT_SKIN);
      return {
        version: 1,
        levels,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        seenIntro: !!parsed.seenIntro,
        coins: typeof parsed.coins === 'number' && parsed.coins >= 0 ? Math.floor(parsed.coins) : earned,
        skins,
        skin: typeof parsed.skin === 'string' && skins.includes(parsed.skin) ? parsed.skin : DEFAULT_SKIN,
        daily: parsed.daily && typeof parsed.daily.streak === 'number' ? parsed.daily : { last: null, streak: 0 },
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

  addCoins(n: number): void {
    this.data.coins = Math.max(0, Math.floor(this.data.coins + n));
    this.save();
  }

  /** Buys a skin if affordable. Returns false (and changes nothing) otherwise. */
  buySkin(id: string, price: number): boolean {
    if (this.data.skins.includes(id)) return true;
    if (this.data.coins < price) return false;
    this.data.coins -= price;
    this.data.skins.push(id);
    this.data.skin = id;
    this.flush();
    return true;
  }

  equipSkin(id: string): void {
    if (!this.data.skins.includes(id)) return;
    this.data.skin = id;
    this.save();
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
