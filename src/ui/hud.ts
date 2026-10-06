import { PIECES, PieceType } from '../core/components';
import type { UIActions } from './actions';
import { el, escapeHtml, hexColor, icon } from './dom';
import { ICON, PIECE_ICON } from './icons';

export interface ToolState {
  type: PieceType;
  left: number;
  total: number;
}

export interface GoalState {
  used: number;
  par: number;
  challenge: string;
  /** Stars already earned on this level (from save). */
  best: number;
}

/** In-level heads-up display: title, star goals, toolbar, actions, selection bubble. */
export class Hud {
  readonly root: HTMLDivElement;
  private title: HTMLDivElement;
  private goals: HTMLDivElement;
  private toolbar: HTMLDivElement;
  private playBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private resetBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private speedBtn: HTMLButtonElement;
  private bubble: HTMLDivElement;
  private cells: HTMLElement[] = [];
  private tools: ToolState[] = [];
  private activeTool: PieceType | null = null;
  private pulseTool: PieceType | null = null;
  /** Shows the full goal list (on narrow screens the pills are icon-only). */
  onGoalsTap: (() => void) | null = null;

  constructor(parent: HTMLElement, private a: UIActions) {
    this.root = el('div', '');
    this.root.id = 'hud';
    parent.appendChild(this.root);

    const top = el('div', 'hud-top');
    const pause = this.iconBtn(ICON.pause, 'Pause (Esc)', () => a.pause());
    this.title = el('div', 'hud-title panel interactive');
    this.goals = el('div', 'hud-goals panel interactive');
    this.goals.addEventListener('click', () => {
      this.a.uiSound('click');
      this.onGoalsTap?.();
    });
    const right = el('div', 'hud-right');
    const hint = this.iconBtn(ICON.hint, 'Hint', () => a.hint());
    hint.classList.add('build-only');
    const cam = this.iconBtn(ICON.camera, 'Reset camera (C)', () => a.resetCamera());
    this.muteBtn = this.iconBtn(ICON.sound, 'Sound (M)', () => a.toggleMute());
    right.append(hint, cam, this.muteBtn);
    top.append(pause, this.title, this.goals, right);

    const bottom = el('div', 'hud-bottom');
    this.toolbar = el('div', 'toolbar panel interactive');
    const actions = el('div', 'actions panel interactive');
    this.undoBtn = this.iconBtn(ICON.undo, 'Undo (Z)', () => a.undo());
    this.undoBtn.classList.add('build-only');
    this.resetBtn = this.iconBtn(ICON.trash, 'Clear construction', () => a.resetBuild());
    this.resetBtn.classList.add('build-only');
    // Run mode: a chunky ×1/×2 toggle and a segmented energy meter.
    this.speedBtn = el('button', 'speed-btn play-only interactive', '<span class="x">×1</span>') as HTMLButtonElement;
    this.speedBtn.title = 'Speed (F)';
    this.speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      a.uiSound('click');
      a.toggleSpeed();
    });
    const speedo = el('div', 'energy');
    speedo.innerHTML = `<i class="bolt">${ICON.bolt}</i><div class="cells">${'<b></b>'.repeat(10)}</div>`;
    this.cells = [...speedo.querySelectorAll<HTMLElement>('.cells b')];
    this.playBtn = el('button', 'play-btn interactive') as HTMLButtonElement;
    this.playBtn.title = 'Play / Stop (Space)';
    this.playBtn.addEventListener('click', () => a.togglePlay());
    actions.append(this.undoBtn, this.resetBtn, speedo, this.speedBtn, this.playBtn);
    bottom.append(this.toolbar, actions);

    this.bubble = el('div', 'bubble panel hidden');

    this.root.append(top, bottom, this.bubble);
    this.setPlaying(false);
  }

  private iconBtn(svg: string, title: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'icon-btn interactive', svg) as HTMLButtonElement;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.a.uiSound('click');
      fn();
    });
    return b;
  }

  show(on: boolean): void {
    this.root.classList.toggle('show', on);
    if (!on) this.hideBubble();
  }

  setLevel(code: string, name: string): void {
    this.title.innerHTML = `<div class="lv">Level ${escapeHtml(code)}</div><div class="nm">${escapeHtml(name)}</div>`;
  }

  setGoals(g: GoalState, complete: { won: boolean; par: boolean; challenge: boolean } | null = null): void {
    const over = g.used > g.par;
    const star = (on: boolean) => icon(on ? ICON.star : ICON.starOutline, '');
    this.goals.innerHTML = `
      <div class="goal ${g.best >= 1 || complete?.won ? 'met' : ''}" title="Reach the goal">${star(g.best >= 1)}<span>Reach the goal</span></div>
      <div class="goal ${over ? 'over' : 'met'} ${g.best >= 2 ? 'done' : ''}" title="Use at most ${g.par} components">${star(g.best >= 2)}<span>${g.used}/${g.par} parts</span></div>
      <div class="goal ${g.best >= 3 ? 'met done' : ''}" title="${escapeHtml(g.challenge)}">${star(g.best >= 3)}<span>${escapeHtml(g.challenge)}</span></div>`;
  }

  setTools(tools: ToolState[], active: PieceType | null): void {
    this.tools = tools;
    this.activeTool = active;
    this.renderTools();
  }

  setPulseTool(t: PieceType | null): void {
    this.pulseTool = t;
    this.renderTools();
  }

  private renderTools(): void {
    this.toolbar.innerHTML = '';
    this.toolbar.classList.toggle('hidden', this.tools.length === 0);
    this.tools.forEach((t, i) => {
      const def = PIECES[t.type];
      const b = el('button', `tool ${t.type === this.activeTool ? 'on' : ''} ${t.left <= 0 ? 'empty' : ''} ${t.type === this.pulseTool ? 'pulse' : ''}`) as HTMLButtonElement;
      b.style.setProperty('--tc', hexColor(def.color));
      b.innerHTML = `<div class="gl">${PIECE_ICON[t.type]}</div><div class="tn">${def.name}</div><div class="cnt">${t.left}</div>`;
      b.title = `${def.name} (${i + 1}) — ${def.blurb}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.a.uiSound('click');
        this.a.selectTool(t.type === this.activeTool ? null : t.type);
      });
      b.addEventListener('pointerenter', () => this.a.uiSound('hover'));
      this.toolbar.appendChild(b);
    });
  }

  setPlaying(playing: boolean, fast = false): void {
    this.root.classList.toggle('playing', playing);
    this.playBtn.classList.toggle('running', playing);
    this.playBtn.innerHTML = playing ? `${icon(ICON.stop)}<span class="lbl">STOP</span>` : `${icon(ICON.play)}<span class="lbl">PLAY</span>`;
    this.speedBtn.classList.toggle('active', fast);
    this.speedBtn.querySelector('.x')!.textContent = fast ? '×2' : '×1';
    if (playing) this.hideBubble();
  }

  setReady(ready: boolean): void {
    this.playBtn.classList.toggle('ready', ready);
  }

  setUndo(can: boolean, anyPlaced: boolean): void {
    this.undoBtn.disabled = !can;
    this.resetBtn.disabled = !anyPlaced;
  }

  setMuted(m: boolean): void {
    this.muteBtn.innerHTML = m ? ICON.mute : ICON.sound;
    this.muteBtn.classList.toggle('active', !m);
  }

  setSpeed(v: number): void {
    const lit = Math.round(Math.min(1, v / 5.5) * this.cells.length);
    this.cells.forEach((c, i) => c.classList.toggle('on', i < lit));
  }

  /** Floating controls next to the selected piece. */
  showBubble(x: number, y: number, opts: { label: string; fixed: boolean; canFlip: boolean }): void {
    const b = this.bubble;
    const key = `${opts.label}|${opts.fixed}|${opts.canFlip}`;
    if (b.dataset.key !== key) {
      b.dataset.key = key;
      b.innerHTML = '';
      const lab = el('div', 'label', escapeHtml(opts.label));
      b.appendChild(lab);
      if (!opts.fixed) {
        b.append(
          this.iconBtn(ICON.move, 'Move (G, or drag the piece)', () => this.a.moveSelected()),
          this.iconBtn(ICON.rotate, 'Rotate (R)', () => this.a.rotateSelected()),
          this.iconBtn(ICON.up, 'Raise (PgUp / ])', () => this.a.raiseSelected(1)),
          this.iconBtn(ICON.down, 'Lower (PgDn / [)', () => this.a.raiseSelected(-1)),
        );
        if (opts.canFlip) b.append(this.iconBtn(ICON.flip, 'Flip route (T)', () => this.a.flipSelected()));
        const del = this.iconBtn(ICON.trash, 'Remove (Del)', () => this.a.removeSelected());
        del.classList.add('danger');
        b.append(del);
      } else b.append(this.iconBtn(ICON.close, 'Close', () => this.a.deselect()));
    }
    b.classList.remove('hidden');
    const w = window.innerWidth;
    const bw = b.offsetWidth || 200;
    const cx = Math.max(bw / 2 + 8, Math.min(w - bw / 2 - 8, x));
    const cy = Math.max(110, y);
    b.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -100%)`;
  }

  hideBubble(): void {
    this.bubble.classList.add('hidden');
  }

  /** Viewport rectangles occupied by HUD chrome (for click-through checks). */
  toolbarElement(): HTMLElement {
    return this.toolbar;
  }
}
