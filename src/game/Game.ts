import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { Board } from '../core/board';
import { PIECES, PieceType } from '../core/components';
import { levelY, RAIL_Y } from '../core/grid';
import { LevelDef, applyPlacements, buildBoard, challengeText, levelMarkers, scoreRun } from '../core/level';
import { FAIL_TEXT, SIM_DT, Simulation } from '../core/simulation';
import { traceFromStart } from '../core/trace';
import { InputController, InputHandler } from '../input/InputController';
import { LEVELS, WORLDS, levelCode } from '../levels';
import { SHOWCASE } from '../levels/showcase';
import type { PlatformAdapter } from '../platform';
import { BallView } from '../rendering/BallView';
import { BoardView } from '../rendering/BoardView';
import { Effects } from '../rendering/effects';
import { Renderer, detectQuality } from '../rendering/Renderer';
import { Persistence, Settings } from '../save/persistence';
import type { UIActions } from '../ui/actions';
import { UI } from '../ui/UI';
import { Builder } from './Builder';
import { playEvents } from './feedback';

type State = 'menu' | 'select' | 'build' | 'play' | 'complete';

/**
 * Top-level orchestrator: owns the systems, the state machine and the frame
 * loop. Gameplay rules live in /core, visuals in /rendering, DOM in /ui.
 */
export class Game implements UIActions, InputHandler {
  readonly r: Renderer;
  readonly view: BoardView;
  readonly ball: BallView;
  readonly fx: Effects;
  readonly audio = new AudioEngine();
  readonly ui: UI;
  readonly input: InputController;
  readonly builder: Builder;

  state: State = 'menu';
  paused = false;
  levelIndex = 0;
  level: LevelDef = LEVELS[0];
  board: Board;
  sim: Simulation | null = null;
  fast = false;
  private acc = 0;
  private failCount = 0;
  private runHandled = false;
  private lastVersion = -1;
  private lastT = 0;
  private completedThisSession = 0;
  private showcaseRestart = 0;
  private hintShown = false;
  private guideActive = false;
  private worldTabFocus = 0;
  /** Debug hooks (dev only). */
  onFrame: ((dt: number) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    readonly platform: PlatformAdapter,
    readonly save: Persistence,
  ) {
    const s = save.data.settings;
    this.r = new Renderer(canvas, s.quality === 'auto' ? detectQuality() : s.quality);
    this.view = new BoardView(this.r.scene);
    this.ball = new BallView(this.r.scene);
    this.fx = new Effects(this.r.scene);
    this.fx.density = this.r.profile.particles;
    this.board = buildBoard(this.level);
    this.builder = new Builder(this.board, this.level, this.view, this.r.camera, this.fx, {
      sound: (k) => this.sfx(k),
      toast: (t, k) => this.ui.toast(t, k),
      changed: () => this.onBuildChanged(),
    });
    this.ui = new UI(this);
    this.ui.settings = s;
    this.input = new InputController(canvas, this.r.cam, this, () => this.r.viewportHeight);
    this.applySettings(s);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('blur', () => {
      if (this.state === 'play' || this.state === 'build') this.pause();
    });
    const unlock = () => {
      this.audio.unlock();
      this.audio.setMuted(this.save.data.settings.muted);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    platform.onAudioChange?.((m) => this.audio.setMuted(m || this.save.data.settings.muted));
    this.onResize();
  }

  start(): void {
    this.showMenu();
    this.lastT = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
      this.lastT = t;
      try {
        this.frame(dt);
      } catch (e) {
        // Never let a single bad frame kill the loop.
        console.error(e);
        this.recover();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Last-resort recovery: drop the run and return to building. */
  private recover(): void {
    if (this.state === 'play') this.stopRun();
  }

  // ================================================================ menus

  private loadShowcase(): void {
    this.board = buildBoard(SHOWCASE);
    applyPlacements(this.board, SHOWCASE.solution);
    this.view.setLevel(this.board, levelMarkers(SHOWCASE).shards, levelMarkers(SHOWCASE).checkpoint);
    this.view.buildMode = false;
    this.view.setEnergized(traceFromStart(this.board).energized, true);
    this.view.setGuides([]);
    const box = this.view.bounds();
    this.r.env.fit(box);
    this.r.cam.frame(box, true);
    this.r.cam.autoOrbit = 0.07;
    this.newShowcaseRun();
  }

  private newShowcaseRun(): void {
    this.sim = new Simulation(this.board, levelMarkers(SHOWCASE), SHOWCASE.start.speed);
    this.view.resetMarkers();
    this.ball.reset(this.sim.pos);
    this.ball.setVisible(true);
    this.runHandled = false;
    this.showcaseRestart = 0;
  }

  showMenu(): void {
    this.closeLevel();
    this.state = 'menu';
    this.ui.closeModal();
    this.ui.show('menu');
    const next = this.continueIndex();
    const total = this.save.totalStars();
    this.ui.setMenuInfo(total, LEVELS.length * 3, total === 0 && !this.save.level(LEVELS[0].id).completed ? 'Play' : `Continue · ${levelCode(LEVELS[next])}`);
    this.loadShowcase();
    this.audio.setIntensity(0.15);
    this.platform.gameplayStop();
  }

  private closeLevel(): void {
    if (this.state === 'play') this.stopRun(true);
    this.persistBuild();
    this.builder.reset(this.board, this.level);
    this.ui.hud.hideBubble();
    this.ui.tip(null);
    this.paused = false;
  }

  continueIndex(): number {
    for (let i = 0; i < LEVELS.length; i++) if (!this.save.level(LEVELS[i].id).completed) return i;
    return LEVELS.length - 1;
  }

  isUnlocked(i: number): boolean {
    if (this.builder.unlimited || i === 0) return true;
    return this.save.level(LEVELS[i - 1].id).completed || this.save.level(LEVELS[i].id).completed;
  }

  // ================================================================ UIActions

  continueGame(): void {
    this.ui.fade(() => this.loadLevel(this.continueIndex()));
  }

  openLevels(): void {
    const wasMenu = this.state === 'menu' || this.state === 'select';
    if (!wasMenu) {
      this.closeLevel();
      this.state = 'select';
      this.loadShowcase();
    }
    this.state = 'select';
    this.ui.closeModal();
    this.worldTabFocus = Math.max(0, WORLDS.findIndex((w) => w.index === LEVELS[this.continueIndex()].world));
    this.renderLevelSelect(this.worldTabFocus);
    this.ui.show('select');
    this.platform.gameplayStop();
  }

  private renderLevelSelect(focus?: number): void {
    const next = this.continueIndex();
    this.ui.renderLevelSelect(
      WORLDS,
      LEVELS.map((level, index) => ({
        level,
        index,
        code: levelCode(level),
        stars: this.save.level(level.id).stars,
        unlocked: this.isUnlocked(index),
        next: index === next && !this.save.level(level.id).completed,
      })),
      this.save.totalStars(),
      LEVELS.length * 3,
      focus,
    );
  }

  startLevel(index: number): void {
    if (!this.isUnlocked(index)) return;
    this.ui.fade(() => this.loadLevel(index));
  }

  backToMenu(): void {
    this.ui.fade(() => this.showMenu());
  }

  selectTool(t: PieceType | null): void {
    if (this.state !== 'build') return;
    this.builder.setTool(t);
    if (t) this.ui.tip(`<b>${PIECES[t].name}</b> — ${PIECES[t].blurb}`, 3200);
    this.refreshHud();
  }

  undo(): void {
    if (this.state === 'build') this.builder.undo();
  }

  resetBuild(): void {
    if (this.state !== 'build' || !this.builder.usedCount()) return;
    this.builder.clear();
    this.ui.toast('Construction cleared — Undo brings it back.', 'info', 2200);
  }

  togglePlay(): void {
    if (this.paused) return;
    if (this.state === 'build') this.startRun();
    else if (this.state === 'play') this.stopRun();
  }

  toggleSpeed(): void {
    this.fast = !this.fast;
    this.ui.hud.setPlaying(this.state === 'play', this.fast);
  }

  pause(): void {
    if (this.paused || (this.state !== 'build' && this.state !== 'play')) return;
    this.paused = true;
    this.input.reset();
    this.ui.hud.hideBubble();
    this.ui.showPause();
    this.audio.sfx?.setRoll(0, false);
    this.platform.gameplayStop();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastT = performance.now();
    this.platform.gameplayStart();
  }

  restart(): void {
    this.ui.fade(() => this.loadLevel(this.levelIndex, false));
  }

  rotateSelected(): void {
    this.builder.rotate();
  }
  raiseSelected(dir: number): void {
    this.builder.raise(dir);
  }
  flipSelected(): void {
    this.builder.flip();
  }
  removeSelected(): void {
    this.builder.remove();
  }
  deselect(): void {
    this.builder.select(null);
  }

  hint(): void {
    const l = this.level;
    this.ui.toast(l.hint ?? l.intro ?? 'Follow the glowing rails from START — every piece must connect.', 'hint', 6000);
  }

  toggleMute(): void {
    const s = this.save.data.settings;
    s.muted = !s.muted;
    this.audio.unlock();
    this.audio.setMuted(s.muted);
    this.ui.hud.setMuted(s.muted);
    this.save.save();
  }

  resetCamera(): void {
    this.r.cam.resetView();
  }

  nextLevel(): void {
    const next = Math.min(LEVELS.length - 1, this.levelIndex + 1);
    this.ui.closeModal();
    const go = () => this.ui.fade(() => this.loadLevel(next));
    // Natural break for platform ads: every third completed level.
    if (this.completedThisSession > 0 && this.completedThisSession % 3 === 0) {
      this.platform
        .commercialBreak(
          () => this.audio.suspend(true),
          () => this.audio.suspend(false),
        )
        .then(go, go);
    } else go();
  }

  replay(): void {
    this.ui.closeModal();
    this.state = 'build';
    this.ui.show('hud');
    this.stopRun(true);
    this.platform.gameplayStart();
  }

  settingsChanged(s: Settings): void {
    this.save.data.settings = s;
    this.applySettings(s);
    this.save.save();
  }

  resetProgress(): void {
    this.save.reset();
    this.ui.toast('Progress reset.', 'info');
    this.showMenu();
  }

  uiSound(kind: 'hover' | 'click'): void {
    this.audio.unlock();
    if (kind === 'hover') this.audio.sfx?.hover();
    else this.audio.sfx?.click();
  }

  private applySettings(s: Settings): void {
    const q = s.quality === 'auto' ? detectQuality() : s.quality;
    if (q !== this.r.quality) {
      this.r.applyQuality(q);
      this.fx.density = this.r.profile.particles;
    }
    this.audio.setVolumes(s.music, s.sfx);
    this.audio.setMuted(s.muted);
    this.ui.hud.setMuted(s.muted);
    this.r.cam.shakeEnabled = s.shake;
  }

  private sfx(kind: 'place' | 'remove' | 'rotate' | 'invalid' | 'undo' | 'click'): void {
    const s = this.audio.sfx;
    if (!s) return;
    if (kind === 'place') s.place();
    else if (kind === 'remove') s.remove();
    else if (kind === 'rotate') s.rotate();
    else if (kind === 'invalid') s.invalid();
    else if (kind === 'undo') s.undo();
    else s.click();
  }

  // ================================================================ level lifecycle

  loadLevel(index: number, restoreBuild = true): void {
    if (this.state === 'play') this.stopRun(true);
    this.persistBuild();
    this.ui.closeModal();
    index = Math.max(0, Math.min(LEVELS.length - 1, index));
    let level = LEVELS[index];
    let board: Board;
    try {
      board = buildBoard(level);
    } catch (e) {
      console.error('Level failed to load', level.id, e);
      this.ui.toast('That level could not be loaded.', 'bad');
      if (index !== 0) return this.loadLevel(0);
      level = LEVELS[0];
      board = buildBoard(level);
    }
    this.levelIndex = index;
    this.level = level;
    this.board = board;
    this.sim = null;
    this.builder.reset(board, level);
    if (restoreBuild) {
      const saved = this.save.level(level.id).build;
      if (saved?.length) this.builder.restore(saved);
    } else this.save.storeBuild(level.id, []);
    const markers = levelMarkers(level);
    this.view.setLevel(board, markers.shards, markers.checkpoint);
    this.view.buildMode = true;
    this.ball.setVisible(false);
    this.fx.clear();
    const box = this.view.bounds();
    this.r.env.fit(box);
    this.r.cam.autoOrbit = 0;
    this.r.cam.follow(null);
    this.r.cam.frame(box, true);
    this.state = 'build';
    this.paused = false;
    this.failCount = 0;
    this.hintShown = false;
    this.fast = false;
    this.lastVersion = -1;
    this.guideActive = !!level.guide;
    this.ui.show('hud');
    this.ui.hud.setLevel(levelCode(level), level.name);
    this.ui.hud.setPlaying(false);
    this.refreshHud();
    this.onBuildChanged();
    if (level.intro) setTimeout(() => this.state === 'build' && this.level === level && this.ui.toast(level.intro!, 'hint', 5200), 450);
    this.audio.setIntensity(0.3);
    this.platform.gameplayStart();
  }

  private persistBuild(): void {
    if (this.state === 'build' || this.state === 'play' || this.state === 'complete') {
      if (this.board.pieces.size && LEVELS.includes(this.level)) this.save.storeBuild(this.level.id, this.builder.placements());
    }
  }

  private onBuildChanged(): void {
    if (this.board.version !== this.lastVersion) {
      this.lastVersion = this.board.version;
      const tr = traceFromStart(this.board);
      this.view.setEnergized(tr.energized, tr.complete);
      this.view.sync();
      this.ui.hud.setReady(tr.complete && this.state === 'build');
      if (this.state === 'build') this.save.storeBuild(this.level.id, this.builder.placements());
      this.updateGuides();
    }
    this.refreshHud();
  }

  private updateGuides(): void {
    if (!this.guideActive) {
      this.view.setGuides([]);
      this.ui.hud.setPulseTool(null);
      return;
    }
    const missing = this.level.solution.filter((p) => {
      const occ = this.board.occupantAt(p.at[0], p.at[2], p.at[1]);
      return !occ || occ.fixed;
    });
    this.view.setGuides(missing.map((p) => ({ x: p.at[0], z: p.at[1], level: p.at[2] })));
    this.ui.hud.setPulseTool(missing.length && !this.builder.tool ? missing[0].type : null);
    if (!missing.length) this.guideActive = false;
  }

  refreshHud(): void {
    if (this.state !== 'build' && this.state !== 'play') return;
    const rec = this.save.level(this.level.id);
    this.ui.hud.setTools(this.builder.tools(), this.builder.tool);
    this.ui.hud.setGoals({ used: this.builder.usedCount(), par: this.level.par, challenge: challengeText(this.level), best: rec.stars });
    this.ui.hud.setUndo(this.builder.history.size > 0, this.builder.usedCount() > 0);
    if (this.guideActive) this.ui.hud.setPulseTool(this.builder.tool ? null : (this.level.solution[0]?.type ?? null));
  }

  // ================================================================ runs

  startRun(): void {
    if (this.state !== 'build') return;
    this.audio.unlock();
    this.builder.select(null);
    this.builder.setTool(null);
    this.view.showGhost(null, null);
    this.ui.tip(null);
    this.ui.hideToast();
    try {
      this.sim = new Simulation(this.board, levelMarkers(this.level), this.level.start.speed);
    } catch (e) {
      console.error(e);
      this.ui.toast('This machine cannot start.', 'bad');
      return;
    }
    this.state = 'play';
    this.runHandled = false;
    this.acc = 0;
    this.view.buildMode = false;
    this.view.resetMarkers();
    this.ball.reset(this.sim.pos);
    this.ball.setVisible(true);
    this.ball.pop(1.5);
    this.fx.burst(this.sim.pos, 0x9ff3ff, 20, 1.6, 0.1, 0.5);
    this.ui.hud.setPlaying(true, this.fast);
    this.ui.hud.setReady(false);
    this.audio.sfx?.go();
    this.audio.sfx?.startRoll();
    this.audio.setIntensity(0.75);
    if (this.save.data.settings.follow) this.r.cam.follow(this.ball.group.position, 0.3);
  }

  stopRun(silent = false): void {
    if (!this.sim && this.state !== 'play') return;
    this.sim = null;
    this.ball.setVisible(false);
    this.view.buildMode = true;
    this.view.resetMarkers();
    this.r.cam.follow(null);
    this.audio.sfx?.stopRoll();
    this.audio.setIntensity(0.3);
    if (this.state === 'play' || this.state === 'complete') this.state = 'build';
    this.ui.hud.setPlaying(false);
    this.lastVersion = -1;
    this.onBuildChanged();
    if (!silent) this.audio.sfx?.stop();
  }

  private handleWin(): void {
    const sim = this.sim!;
    const goal = [...this.board.pieces.values()].find((p) => p.type === 'goal')!;
    const gp = { x: goal.x, y: levelY(goal.level) + RAIL_Y, z: goal.z };
    this.audio.sfx?.win();
    this.audio.sfx?.stopRoll();
    this.r.cam.shake(0.12);
    this.fx.burst(gp, 0xfde68a, 90, 3.6, 0.16, 1.4, 1.3);
    this.fx.burst(gp, 0x9ff3ff, 40, 2.4, 0.12, 1.1, 1.5);
    this.fx.ring(gp, 0xfde68a, 2.6, 0.8);
    setTimeout(() => this.fx.ring(gp, 0xffffff, 1.6, 0.6), 160);
    this.view.flash(goal.id);
    this.ball.pop(1.8);

    const placements = this.builder.placements();
    const result = { won: true, stats: sim.stats, piecesUsed: placements.length, typesUsed: new Set(placements.map((p) => p.type)) };
    const score = scoreRun(this.level, result);
    const prev = this.save.level(this.level.id);
    const firstTime = !prev.completed;
    const { newBest } = this.save.recordResult(this.level.id, score.stars, sim.stats.time);
    this.completedThisSession++;
    if (score.stars === 3) this.platform.happyTime();
    const level = this.level;
    setTimeout(() => {
      if (this.level !== level || this.state !== 'play') return;
      this.state = 'complete';
      this.platform.gameplayStop();
      this.ui.showComplete(
        {
          stars: score.stars,
          time: sim.stats.time,
          used: placements.length,
          par: level.par,
          challenge: challengeText(level),
          challengeMet: score.challenge,
          newBest,
          firstTime,
          hasNext: this.levelIndex < LEVELS.length - 1,
        },
        (i) => {
          this.audio.sfx?.star(i);
          this.fx.burst(gp, 0xfde68a, 20, 2.5, 0.12, 0.8);
        },
      );
      this.refreshHud();
    }, 1300);
  }

  private handleFail(): void {
    const sim = this.sim!;
    this.audio.sfx?.fail();
    this.audio.sfx?.setRoll(0, false);
    this.failCount++;
    this.ui.toast(FAIL_TEXT[sim.failReason ?? 'fell'], 'bad', 2600);
    if (sim.failReason === 'crash' || sim.failReason === 'fell') this.r.cam.shake(0.04);
    if (this.failCount >= 2 && !this.hintShown && this.level.hint && this.save.data.settings.hints) {
      this.hintShown = true;
      const level = this.level;
      setTimeout(() => this.level === level && this.ui.toast(level.hint!, 'hint', 6500), 2700);
    }
  }

  // ================================================================ frame

  private frame(dt: number): void {
    const playing = this.state === 'play' && !this.paused;
    const backdrop = this.state === 'menu' || this.state === 'select';
    if (this.sim && (playing || backdrop)) {
      this.acc = Math.min(this.acc + dt * (this.fast && playing ? 2 : 1), 0.25);
      while (this.acc >= SIM_DT) {
        this.sim.step();
        this.acc -= SIM_DT;
      }
      const events = this.sim.drainEvents();
      playEvents(events, { board: this.board, view: this.view, ball: this.ball, fx: this.fx, cam: this.r.cam, audio: backdrop ? null : this.audio });
      const failed = this.sim.mode === 'failed';
      this.ball.update(dt, this.sim.pos, this.sim.speed, failed ? 1 : 0);
      if (playing) {
        this.ui.hud.setSpeed(this.sim.speed);
        this.audio.sfx?.setRoll(this.sim.speed, this.sim.mode === 'rail');
        if (this.sim.mode === 'won' && !this.runHandled) {
          this.runHandled = true;
          this.handleWin();
        } else if (failed && !this.runHandled) {
          this.runHandled = true;
          this.handleFail();
        }
        if (failed && this.sim.done) this.stopRun(true);
      } else if (backdrop && this.sim.done) {
        this.showcaseRestart += dt;
        if (this.showcaseRestart > 1.2) this.newShowcaseRun();
      } else if (backdrop && this.sim.mode === 'won' && !this.runHandled) {
        this.runHandled = true;
        const goal = [...this.board.pieces.values()].find((p) => p.type === 'goal');
        if (goal) this.fx.burst({ x: goal.x, y: levelY(goal.level) + RAIL_Y, z: goal.z }, 0xfde68a, 50, 3, 0.14, 1.2, 1.2);
      }
      if (backdrop && this.sim.mode === 'won') {
        this.showcaseRestart += dt;
        if (this.showcaseRestart > 2.4) this.newShowcaseRun();
      }
    }
    this.ball.relax(dt);
    this.view.update(dt, this.sim);
    this.fx.update(dt);

    if (this.state === 'build' && !this.paused) this.updateBubble();
    else this.ui.hud.hideBubble();
    this.onFrame?.(dt);
    this.r.render(dt);
  }

  private updateBubble(): void {
    const p = this.builder.selectedPiece();
    if (!p) {
      this.ui.hud.hideBubble();
      return;
    }
    const wp = this.view.pieceWorldPos(p.id);
    if (!wp) return;
    const v = wp.project(this.r.camera);
    const rect = this.r.canvas.getBoundingClientRect();
    const x = rect.left + ((v.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - v.y) / 2) * rect.height - 10;
    this.ui.hud.showBubble(x, y, { label: PIECES[p.type].name, fixed: p.fixed, canFlip: p.type === 'splitter' && !p.fixed });
    if (p.fixed) this.ui.tip(`<b>${PIECES[p.type].name}</b> — ${PIECES[p.type].blurb}`, 2500);
  }

  // ================================================================ input

  hover(ndc: THREE.Vector2 | null): void {
    if (this.state !== 'build' || this.paused) return;
    this.builder.hover(ndc);
  }

  tap(ndc: THREE.Vector2, touch: boolean): void {
    this.audio.unlock();
    if (this.state !== 'build' || this.paused || this.ui.modalOpen) return;
    this.builder.tap(ndc, touch);
    this.refreshHud();
  }

  cameraMoved(): void {
    if (this.state === 'build') this.builder.refreshHover();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key;
    if (k === 'Escape') {
      if (this.ui.modalOpen) {
        if (this.ui.modalOpen !== 'complete') this.ui.closeModal();
        return;
      }
      if (this.state === 'select') return this.backToMenu();
      if (this.builder.tool || this.builder.selected !== null) {
        this.builder.setTool(null);
        this.builder.select(null);
        this.refreshHud();
        return;
      }
      if (this.state === 'build' || this.state === 'play') this.pause();
      return;
    }
    if (this.ui.modalOpen || this.paused) return;
    if (this.state !== 'build' && this.state !== 'play') return;
    const build = this.state === 'build';
    const cam = this.r.cam;
    switch (k.toLowerCase()) {
      case ' ':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'r':
        if (build) this.builder.rotate();
        break;
      case 'delete':
      case 'backspace':
        if (build) this.builder.remove();
        break;
      case 'z':
        if (build) this.builder.undo();
        break;
      case ']':
      case 'pageup':
        if (build) this.builder.raise(1);
        break;
      case '[':
      case 'pagedown':
        if (build) this.builder.raise(-1);
        break;
      case 't':
        if (build) this.builder.flip();
        break;
      case 'c':
        this.resetCamera();
        break;
      case 'm':
        this.toggleMute();
        break;
      case 'f':
        if (!build) this.toggleSpeed();
        break;
      case 'h':
        this.hint();
        break;
      case 'q':
        cam.orbit(0.3, 0);
        break;
      case 'e':
        cam.orbit(-0.3, 0);
        break;
      case 'arrowleft':
      case 'a':
        cam.pan(60, 0, this.r.viewportHeight);
        break;
      case 'arrowright':
      case 'd':
        cam.pan(-60, 0, this.r.viewportHeight);
        break;
      case 'arrowup':
      case 'w':
        cam.pan(0, 60, this.r.viewportHeight);
        break;
      case 'arrowdown':
      case 's':
        cam.pan(0, -60, this.r.viewportHeight);
        break;
      default:
        if (build && /^[1-9]$/.test(k)) {
          const t = this.builder.tools()[Number(k) - 1];
          if (t) this.selectTool(this.builder.tool === t.type ? null : t.type);
        }
    }
    this.refreshHud();
  }

  private onVisibility(): void {
    if (document.hidden) {
      if (this.state === 'build' || this.state === 'play') this.pause();
      this.audio.suspend(true);
      this.save.flush();
    } else {
      this.audio.suspend(false);
      this.lastT = performance.now();
    }
  }

  private onResize(): void {
    this.r.resize();
    this.fx.setViewportHeight(this.r.viewportHeight);
    this.ball.setViewportHeight(this.r.viewportHeight);
    if (this.board) this.r.cam.frame(this.view.bounds(), false, false);
  }
}
