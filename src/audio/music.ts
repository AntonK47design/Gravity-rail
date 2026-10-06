import type { AudioEngine } from './AudioEngine';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// D lydian-flavoured progression: Dmaj9 · Bm9 · Gmaj9(#11) · Aadd9 / Esus
const CHORDS = [
  [50, 57, 61, 64, 66],
  [47, 54, 57, 61, 62],
  [43, 50, 54, 57, 61],
  [45, 52, 57, 59, 64],
];
const SCALE = [62, 64, 66, 69, 71, 73, 74, 76, 78, 81];
const BAR = 8;

/**
 * Generative ambient score: slow pads, a soft bass and sparse glassy plucks
 * whose density follows the game's "intensity" (building → machine running).
 */
export class Music {
  private timer: number | null = null;
  private nextBar = 0;
  private bar = 0;
  private intensity = 0.2;
  private filter: BiquadFilterNode;
  private seed = 3;

  constructor(private a: AudioEngine) {
    const ctx = a.ctx!;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 0.4;
    this.filter.connect(a.musicBus);
    this.filter.connect(a.reverbSend);
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  start(): void {
    if (this.timer !== null) return;
    const ctx = this.a.ctx!;
    this.nextBar = ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    const ctx = this.a.ctx;
    if (ctx) this.filter.frequency.setTargetAtTime(700 + this.intensity * 1600, ctx.currentTime, 1.5);
  }

  private schedule(): void {
    const ctx = this.a.ctx!;
    if (ctx.state !== 'running') {
      this.nextBar = Math.max(this.nextBar, ctx.currentTime + 0.1);
      return;
    }
    while (this.nextBar < ctx.currentTime + 1.5) {
      this.playBar(this.nextBar, CHORDS[this.bar % CHORDS.length]);
      this.nextBar += BAR;
      this.bar++;
    }
  }

  private playBar(t0: number, chord: number[]): void {
    const ctx = this.a.ctx!;
    // Pad
    for (const n of chord.slice(1)) this.pad(t0, mtof(n), BAR + 2.5);
    // Bass
    this.voice(t0, mtof(chord[0] - 12), BAR, 'sine', 0.09, 1.2, 2.5);
    // Plucks — density follows intensity
    const steps = 16;
    const p = 0.12 + this.intensity * 0.35;
    for (let i = 0; i < steps; i++) {
      if (this.rnd() > p) continue;
      const note = SCALE[Math.floor(this.rnd() * SCALE.length)];
      const t = t0 + (i * BAR) / steps;
      this.pluck(t, mtof(note + (this.rnd() < 0.25 ? 12 : 0)), 0.045 + this.rnd() * 0.03);
    }
    void ctx;
  }

  private pad(t: number, f: number, dur: number): void {
    for (const det of [-6, 6]) this.voice(t, f, dur, 'triangle', 0.028, 2.4, 3, det);
  }

  private voice(t: number, f: number, dur: number, type: OscillatorType, vol: number, attack: number, release: number, detune = 0): void {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + dur - release);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(this.filter);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private pluck(t: number, f: number, vol: number): void {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.a.musicBus);
    g.connect(this.a.reverbSend);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.7);
    o2.stop(t + 1.7);
  }
}
