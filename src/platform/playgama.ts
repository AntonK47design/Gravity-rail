import { PlatformAdapter, loadScript } from './PlatformAdapter';

/* Minimal typing for the Playgama Bridge APIs we use. */
interface Bridge {
  initialize(): Promise<void>;
  platform: { sendMessage(msg: string): Promise<void> | void };
  advertisement: {
    showInterstitial(): void;
    showRewarded(placement?: string): void;
    isRewardedSupported?: boolean;
    on(event: string, cb: (state: string) => void): void;
  };
  game?: { on(event: string, cb: (state: string) => void): void };
  EVENT_NAME?: Record<string, string>;
}

const BRIDGE_URL = 'https://bridge.playgama.com/v1/stable/playgama-bridge.js';

export class PlaygamaPlatform implements PlatformAdapter {
  readonly name = 'playgama';
  private bridge: Bridge | null = null;
  private adCb: ((state: string) => void) | null = null;
  private rewardCb: ((state: string) => void) | null = null;

  async init(): Promise<void> {
    const w = window as unknown as { bridge?: Bridge };
    if (!w.bridge) await loadScript(BRIDGE_URL);
    try {
      if (w.bridge) {
        await w.bridge.initialize();
        this.bridge = w.bridge;
        this.bridge.advertisement.on('interstitial_state_changed', (state) => this.adCb?.(state));
        this.bridge.advertisement.on('rewarded_state_changed', (state) => this.rewardCb?.(state));
      }
    } catch (e) {
      console.warn('[platform] Playgama bridge unavailable, continuing without it', e);
      this.bridge = null;
    }
  }

  private send(msg: string): void {
    try {
      void this.bridge?.platform.sendMessage(msg);
    } catch {
      /* ignore */
    }
  }

  loadingStart(): void {}
  loadingStop(): void {
    this.send('game_ready');
  }
  gameplayStart(): void {
    this.send('gameplay_started');
  }
  gameplayStop(): void {
    this.send('gameplay_stopped');
  }
  happyTime(): void {}

  commercialBreak(pause: () => void, resume: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (!this.bridge) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.adCb = null;
        resume();
        resolve();
      };
      this.adCb = (state) => {
        if (state === 'opened') pause();
        if (state === 'closed' || state === 'failed') finish();
      };
      try {
        this.bridge.advertisement.showInterstitial();
      } catch {
        finish();
      }
      window.setTimeout(finish, 45000);
    });
  }

  get rewardedAvailable(): boolean {
    try {
      return !!this.bridge && this.bridge.advertisement.isRewardedSupported !== false;
    } catch {
      return false;
    }
  }

  showRewarded(placement: string, pause: () => void, resume: () => void): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.bridge) return resolve(false);
      let rewarded = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.rewardCb = null;
        resume();
        resolve(rewarded);
      };
      this.rewardCb = (state) => {
        if (state === 'opened') pause();
        else if (state === 'rewarded') rewarded = true; // grant only on this state
        else if (state === 'closed' || state === 'failed') finish();
      };
      try {
        this.bridge.advertisement.showRewarded(placement);
      } catch {
        finish();
      }
      window.setTimeout(finish, 90000);
    });
  }

  onAudioChange(cb: (muted: boolean) => void): void {
    try {
      this.bridge?.game?.on('visibility_state_changed', (state) => cb(state === 'hidden'));
    } catch {
      /* ignore */
    }
  }
}
