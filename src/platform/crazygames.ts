import { PlatformAdapter, loadScript } from './PlatformAdapter';

/* Minimal typing for the parts of the CrazyGames SDK v3 we use. */
interface CGSDK {
  init(): Promise<void>;
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(cb: (s: { muteAudio?: boolean }) => void): void;
  };
  ad: {
    requestAd(type: 'midgame' | 'rewarded', cb: { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void }): void;
  };
}

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

export class CrazyGamesPlatform implements PlatformAdapter {
  readonly name = 'crazygames';
  private sdk: CGSDK | null = null;
  private playing = false;

  async init(): Promise<void> {
    const w = window as unknown as { CrazyGames?: { SDK: CGSDK } };
    if (!w.CrazyGames) await loadScript(SDK_URL);
    try {
      if (w.CrazyGames?.SDK) {
        await w.CrazyGames.SDK.init();
        this.sdk = w.CrazyGames.SDK;
      }
    } catch (e) {
      console.warn('[platform] CrazyGames SDK unavailable, continuing without it', e);
      this.sdk = null;
    }
  }

  private safe(fn: (s: CGSDK) => void): void {
    if (!this.sdk) return;
    try {
      fn(this.sdk);
    } catch (e) {
      console.warn('[platform] CrazyGames call failed', e);
    }
  }

  loadingStart(): void {
    this.safe((s) => s.game.loadingStart());
  }
  loadingStop(): void {
    this.safe((s) => s.game.loadingStop());
  }
  gameplayStart(): void {
    if (this.playing) return;
    this.playing = true;
    this.safe((s) => s.game.gameplayStart());
  }
  gameplayStop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.safe((s) => s.game.gameplayStop());
  }
  happyTime(): void {
    this.safe((s) => s.game.happytime());
  }

  commercialBreak(pause: () => void, resume: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sdk) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resume();
        resolve();
      };
      try {
        this.sdk.ad.requestAd('midgame', { adStarted: pause, adFinished: finish, adError: finish });
      } catch {
        finish();
      }
      window.setTimeout(finish, 45000);
    });
  }

  get rewardedAvailable(): boolean {
    return !!this.sdk;
  }

  showRewarded(_placement: string, pause: () => void, resume: () => void): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.sdk) return resolve(false);
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resume();
        resolve(ok);
      };
      try {
        this.sdk.ad.requestAd('rewarded', { adStarted: pause, adFinished: () => finish(true), adError: () => finish(false) });
      } catch {
        finish(false);
      }
      window.setTimeout(() => finish(false), 90000);
    });
  }

  onAudioChange(cb: (muted: boolean) => void): void {
    this.safe((s) => {
      if (s.game.settings?.muteAudio !== undefined) cb(!!s.game.settings.muteAudio);
      s.game.addSettingsChangeListener?.((st) => {
        if (st.muteAudio !== undefined) cb(!!st.muteAudio);
      });
    });
  }
}
