import { Music } from './music';
import { Sfx } from './sfx';

/**
 * WebAudio root. Everything is synthesised at runtime — zero audio assets,
 * zero loading time. The context is created lazily on the first user gesture
 * (browser autoplay policy) and suspended when the game is hidden.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  music: Music | null = null;
  sfx: Sfx | null = null;
  private musicVol = 0.6;
  private sfxVol = 0.8;
  private muted = false;
  private suspendedByGame = false;
  private wantMusic = true;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      comp.connect(this.master);
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.connect(comp);
      this.sfxBus.connect(comp);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.35;
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(comp);
      this.sfx = new Sfx(this);
      this.music = new Music(this);
      this.applyVolumes();
      if (this.wantMusic) this.music.start();
    }
    if (this.ctx.state === 'suspended' && !this.suspendedByGame) this.ctx.resume().catch(() => undefined);
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    let seed = 11;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = (seed / 2147483647 - 0.5) * 2 * Math.pow(1 - i / len, 3.2);
      }
    }
    return buf;
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    this.applyVolumes();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVol * 0.5, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.sfxVol, t, 0.05);
  }

  /** Pause/resume all audio (tab hidden, ads, pause menu with audio off). */
  suspend(s: boolean): void {
    this.suspendedByGame = s;
    if (!this.ctx) return;
    if (s) this.ctx.suspend().catch(() => undefined);
    else this.ctx.resume().catch(() => undefined);
  }

  /** Music intensity 0..1 (menu calm → machine running). */
  setIntensity(v: number): void {
    this.music?.setIntensity(v);
  }
}
