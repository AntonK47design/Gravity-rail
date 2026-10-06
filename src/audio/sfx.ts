import type { AudioEngine } from './AudioEngine';

/** Synthesised sound effects + the continuous rolling/energy hum of the sphere. */
export class Sfx {
  private noise: AudioBuffer;
  private rollSrc: AudioBufferSourceNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private humOsc: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private lastPlay = new Map<string, number>();

  constructor(private a: AudioEngine) {
    const ctx = a.ctx!;
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 5;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
  }

  private get ctx(): AudioContext {
    return this.a.ctx!;
  }

  /** Rate-limit identical sounds so rapid events don't stack into noise. */
  private gate(key: string, minGap: number): boolean {
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < minGap) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private tone(f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, reverb = 0.2): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.a.sfxBus);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      g.connect(s).connect(this.a.reverbSend);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, vol: number, f0: number, f1: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.a.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  hover(): void {
    if (this.gate('hover', 0.05)) this.tone(1800, 1700, 0.04, 0.025, 'sine', 0, 0);
  }
  click(): void {
    this.tone(1200, 800, 0.06, 0.07, 'triangle', 0, 0.05);
  }
  place(): void {
    this.tone(220, 90, 0.16, 0.22, 'sine', 0, 0.15);
    this.hiss(0.05, 0.12, 3000, 1500, 1.5);
    this.tone(880, 880, 0.08, 0.04, 'triangle', 0.03, 0.2);
  }
  remove(): void {
    this.tone(160, 320, 0.12, 0.12, 'sine', 0, 0.1);
    this.hiss(0.08, 0.06, 1200, 4000, 1.2);
  }
  rotate(): void {
    this.tone(700, 950, 0.06, 0.08, 'triangle', 0, 0.05);
    this.hiss(0.03, 0.05, 5000, 4000, 2);
  }
  invalid(): void {
    if (this.gate('invalid', 0.15)) {
      this.tone(140, 120, 0.14, 0.12, 'square', 0, 0);
      this.tone(150, 125, 0.14, 0.08, 'square', 0.07, 0);
    }
  }
  undo(): void {
    this.tone(600, 400, 0.08, 0.08, 'triangle', 0, 0.1);
  }
  go(): void {
    this.tone(392, 392, 0.12, 0.1, 'triangle', 0, 0.3);
    this.tone(587, 587, 0.22, 0.1, 'triangle', 0.08, 0.4);
    this.hiss(0.35, 0.05, 400, 3000, 0.8);
  }
  stop(): void {
    this.tone(500, 300, 0.12, 0.08, 'triangle', 0, 0.1);
  }
  boost(): void {
    if (!this.gate('boost', 0.25)) return;
    this.tone(200, 900, 0.35, 0.08, 'sawtooth', 0, 0.2);
    this.hiss(0.35, 0.1, 600, 5000, 1);
  }
  brake(): void {
    if (!this.gate('brake', 0.25)) return;
    this.hiss(0.3, 0.1, 3500, 900, 3);
  }
  bounce(speed: number): void {
    if (!this.gate('bounce', 0.08)) return;
    const v = Math.min(1, speed / 4);
    for (const [f, d] of [[620, 0.3], [1490, 0.18], [2310, 0.12]]) this.tone(f, f * 0.98, d, 0.06 * (0.3 + v), 'sine', 0, 0.3);
  }
  switch(): void {
    this.tone(880, 880, 0.08, 0.1, 'square', 0, 0.2);
    this.tone(1320, 1320, 0.12, 0.08, 'square', 0.07, 0.3);
  }
  gate_(): void {
    this.hiss(0.25, 0.08, 800, 300, 2);
  }
  teleport(): void {
    this.tone(300, 2400, 0.25, 0.1, 'sine', 0, 0.5);
    this.tone(2400, 500, 0.3, 0.07, 'sine', 0.18, 0.6);
    this.hiss(0.4, 0.05, 6000, 1000, 4);
  }
  launch(): void {
    this.tone(120, 50, 0.25, 0.3, 'sine', 0, 0.2);
    this.hiss(0.4, 0.14, 800, 4000, 0.7);
  }
  land(impact: number): void {
    if (!this.gate('land', 0.06)) return;
    const v = Math.min(1, impact / 4);
    this.tone(160, 70, 0.14, 0.12 + v * 0.18, 'sine', 0, 0.1);
    this.hiss(0.05, 0.05 + v * 0.06, 2500, 1200, 1);
  }
  catch_(): void {
    this.tone(400, 900, 0.3, 0.08, 'triangle', 0, 0.4);
  }
  shard(i: number): void {
    const f = 1046 * Math.pow(2, (i % 5) * (2 / 12));
    this.tone(f, f, 0.5, 0.08, 'sine', 0, 0.6);
    this.tone(f * 2, f * 2, 0.35, 0.04, 'sine', 0.03, 0.6);
  }
  checkpoint(): void {
    this.tone(784, 784, 0.3, 0.08, 'triangle', 0, 0.5);
    this.tone(1175, 1175, 0.4, 0.07, 'triangle', 0.1, 0.6);
  }
  win(): void {
    const notes = [587, 740, 880, 1175, 1480];
    notes.forEach((f, i) => this.tone(f, f, 1.2 - i * 0.1, 0.09, 'triangle', i * 0.08, 0.7));
    this.tone(147, 147, 1.6, 0.14, 'sine', 0, 0.3);
    this.hiss(1.2, 0.05, 8000, 3000, 0.5, 0.1, 'highpass');
  }
  fail(): void {
    this.tone(330, 300, 0.3, 0.08, 'triangle', 0, 0.4);
    this.tone(262, 230, 0.45, 0.08, 'triangle', 0.15, 0.4);
  }
  star(i: number): void {
    const f = [784, 988, 1319][i] ?? 1319;
    this.tone(f, f, 0.7, 0.11, 'triangle', 0, 0.7);
    this.tone(f * 1.5, f * 1.5, 0.5, 0.05, 'sine', 0.04, 0.7);
  }
  whoosh(): void {
    this.hiss(0.35, 0.05, 300, 2000, 0.7);
  }

  // ---------------------------------------------------------------- rolling

  startRoll(): void {
    if (this.rollSrc) return;
    const ctx = this.ctx;
    this.rollSrc = ctx.createBufferSource();
    this.rollSrc.buffer = this.noise;
    this.rollSrc.loop = true;
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'bandpass';
    this.rollFilter.Q.value = 1.4;
    this.rollFilter.frequency.value = 300;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.rollSrc.connect(this.rollFilter).connect(this.rollGain).connect(this.a.sfxBus);
    this.rollSrc.start();
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sine';
    this.humOsc.frequency.value = 110;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humOsc.connect(this.humGain).connect(this.a.sfxBus);
    this.humOsc.start();
  }

  setRoll(speed: number, onRail: boolean): void {
    if (!this.rollGain || !this.rollFilter || !this.humGain || !this.humOsc) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, speed / 6);
    this.rollGain.gain.setTargetAtTime(onRail ? 0.04 + v * 0.16 : 0, t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(180 + v * 900, t, 0.05);
    this.humGain.gain.setTargetAtTime(0.012 + v * 0.03, t, 0.1);
    this.humOsc.frequency.setTargetAtTime(110 + v * 180, t, 0.1);
  }

  stopRoll(): void {
    const t = this.ctx.currentTime;
    this.rollGain?.gain.setTargetAtTime(0, t, 0.05);
    this.humGain?.gain.setTargetAtTime(0, t, 0.05);
    const src = this.rollSrc;
    const hum = this.humOsc;
    this.rollSrc = null;
    this.humOsc = null;
    setTimeout(() => {
      try {
        src?.stop();
        hum?.stop();
      } catch {
        /* already stopped */
      }
    }, 300);
  }
}
