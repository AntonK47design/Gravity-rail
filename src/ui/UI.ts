import type { LevelDef } from '../core/level';
import type { Settings } from '../save/persistence';
import type { UIActions } from './actions';
import { el, escapeHtml, icon } from './dom';
import { Hud } from './hud';
import { ICON } from './icons';
import { CURRENCY, DAILY_REWARDS, DailyStatus } from '../meta/economy';
import type { Skin } from '../meta/skins';

export interface ShopView {
  coins: number;
  owned: string[];
  equipped: string;
  skins: Skin[];
}

export interface WorldInfo {
  index: number;
  name: string;
  desc: string;
}

export interface LevelCardInfo {
  level: LevelDef;
  index: number;
  code: string;
  stars: number;
  unlocked: boolean;
  next: boolean;
}

export interface CompleteInfo {
  stars: number;
  time: number;
  used: number;
  par: number;
  challenge: string;
  challengeMet: boolean;
  /** Gears earned by this run. */
  coins: number;
  /** Offer "watch an ad to double" (platform supports rewarded ads). */
  canDouble: boolean;
  newBest: boolean;
  hasNext: boolean;
  firstTime: boolean;
}

type Screen = 'menu' | 'select' | 'hud' | 'none';

/** Root of all DOM UI: screens, HUD, modals, toasts. */
export class UI {
  readonly root: HTMLElement;
  readonly hud: Hud;
  private menu: HTMLDivElement;
  private select: HTMLDivElement;
  private modalWrap: HTMLDivElement;
  private modal: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private tipEl: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private toastTimer = 0;
  private tipTimer = 0;
  private menuStars: HTMLSpanElement;
  private walletEl: HTMLSpanElement;
  private dailyDot: HTMLElement;
  private continueBtn: HTMLButtonElement;
  private worldTab = 0;
  modalOpen: string | null = null;
  private onModalClose: (() => void) | null = null;

  constructor(private a: UIActions) {
    this.root = document.getElementById('ui')!;

    // Main menu
    this.menu = el('div', 'screen');
    this.menu.id = 'menu';
    this.menu.innerHTML = `
      <h1 class="title"><span>GRAVITY</span><span class="t2">RAIL</span></h1>
      <div class="tagline">Build it · Start it · Watch it come alive</div>
      <div class="menu-buttons"></div>
      <div class="menu-foot"><span class="stars-total"><i>${ICON.star}</i><span></span></span></div>
      <div class="menu-corner"><button class="wallet-chip" title="${CURRENCY}"><i>${ICON.cog}</i><span>0</span></button><button class="icon-btn daily-btn" title="Daily reward">${ICON.gift}<b class="dot hidden"></b></button></div>`;
    const mb = this.menu.querySelector('.menu-buttons')!;
    this.continueBtn = this.button('Play', () => a.continueGame(), 'primary', ICON.play);
    mb.append(
      this.continueBtn,
      this.button('Levels', () => a.openLevels(), '', ICON.grid),
      this.button('Shop', () => a.openShop(), '', ICON.bag),
      this.button('Settings', () => this.showSettings(), '', ICON.gear),
      this.button('How to play', () => this.showHowTo(), '', ICON.help),
    );
    this.menuStars = this.menu.querySelector('.stars-total span') as HTMLSpanElement;
    this.walletEl = this.menu.querySelector('.wallet-chip span') as HTMLSpanElement;
    this.dailyDot = this.menu.querySelector('.daily-btn .dot') as HTMLElement;
    this.menu.querySelector('.wallet-chip')!.addEventListener('click', () => {
      a.uiSound('click');
      a.openShop();
    });
    this.menu.querySelector('.daily-btn')!.addEventListener('click', () => {
      a.uiSound('click');
      a.openDaily();
    });

    this.select = el('div', 'screen');
    this.select.id = 'select';

    this.hud = new Hud(this.root, a);

    this.modalWrap = el('div', 'modal-wrap');
    this.modal = el('div', 'modal panel');
    this.modalWrap.appendChild(this.modal);
    this.modalWrap.addEventListener('pointerdown', (e) => {
      if (e.target === this.modalWrap && this.modalOpen && this.modalOpen !== 'complete') this.closeModal();
    });

    this.toastEl = el('div', 'toast panel');
    this.tipEl = el('div', 'tooltip panel');
    this.fadeEl = el('div', 'fade');

    this.root.append(this.menu, this.select, this.toastEl, this.tipEl, this.modalWrap, this.fadeEl);
    this.modalWrap.style.pointerEvents = 'none';
  }

  private button(label: string, fn: () => void, cls = '', svg = ''): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, `${svg ? icon(svg) : ''}<span>${escapeHtml(label)}</span>`) as HTMLButtonElement;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.a.uiSound('click');
      fn();
    });
    b.addEventListener('pointerenter', () => this.a.uiSound('hover'));
    return b;
  }

  show(screen: Screen): void {
    this.menu.classList.toggle('show', screen === 'menu');
    this.select.classList.toggle('show', screen === 'select');
    this.hud.show(screen === 'hud');
    this.menu.style.visibility = screen === 'menu' ? 'visible' : 'hidden';
    this.select.style.visibility = screen === 'select' ? 'visible' : 'hidden';
  }

  setWallet(coins: number, dailyAvailable: boolean): void {
    this.walletEl.textContent = String(coins);
    this.dailyDot.classList.toggle('hidden', !dailyAvailable);
  }

  setMenuInfo(totalStars: number, maxStars: number, continueLabel: string): void {
    this.menuStars.textContent = `${totalStars} / ${maxStars}`;
    this.continueBtn.querySelector('span')!.textContent = continueLabel;
  }

  /** Brief black fade used to mask level transitions. */
  async fade(fn: () => void | Promise<void>): Promise<void> {
    this.fadeEl.classList.add('on');
    await new Promise((r) => setTimeout(r, 260));
    await fn();
    requestAnimationFrame(() => this.fadeEl.classList.remove('on'));
  }

  // ---------------------------------------------------------------- level select

  renderLevelSelect(worlds: WorldInfo[], cards: LevelCardInfo[], totalStars: number, maxStars: number, focusWorld?: number): void {
    if (focusWorld !== undefined) this.worldTab = focusWorld;
    const s = this.select;
    s.innerHTML = '';
    const head = el('div', 'select-head');
    const back = el('button', 'icon-btn interactive', ICON.back) as HTMLButtonElement;
    back.title = 'Back';
    back.addEventListener('click', () => {
      this.a.uiSound('click');
      this.a.backToMenu();
    });
    head.append(back, el('h2', '', 'Select level'), el('div', 'stars-total', `<i>${ICON.star}</i>${totalStars} / ${maxStars}`));
    s.appendChild(head);

    const tabs = el('div', 'worlds');
    const desc = el('div', 'world-desc');
    const grid = el('div', 'level-grid');
    const renderGrid = () => {
      grid.innerHTML = '';
      const w = worlds[this.worldTab];
      desc.textContent = w.desc;
      tabs.querySelectorAll('.world-tab').forEach((t, i) => t.classList.toggle('on', i === this.worldTab));
      cards
        .filter((c) => c.level.world === w.index)
        .forEach((c, i) => {
          const b = el('button', `level-card ${c.unlocked ? '' : 'locked'} ${c.next ? 'next' : ''}`) as HTMLButtonElement;
          b.style.animationDelay = `${i * 40}ms`;
          const stars = [0, 1, 2].map((k) => `<i class="${k < c.stars ? 'on' : ''}">${ICON.star}</i>`).join('');
          b.innerHTML = `<div class="orb"></div><div><div class="num">${c.code}</div><div class="nm">${escapeHtml(c.level.name)}</div></div><div class="st">${stars}</div>${c.unlocked ? '' : `<i class="lock">${ICON.lock}</i>`}`;
          b.addEventListener('click', () => {
            this.a.uiSound('click');
            this.a.startLevel(c.index);
          });
          b.addEventListener('pointerenter', () => this.a.uiSound('hover'));
          grid.appendChild(b);
        });
    };
    worlds.forEach((w, i) => {
      const unlocked = cards.some((c) => c.level.world === w.index && c.unlocked);
      const got = cards.filter((c) => c.level.world === w.index).reduce((n, c) => n + c.stars, 0);
      const total = cards.filter((c) => c.level.world === w.index).length * 3;
      const t = el('button', `world-tab ${unlocked ? '' : 'locked'}`, `<div class="wn">WORLD ${w.index} · ${got}/${total}★</div><div class="wt">${escapeHtml(w.name)}</div>`) as HTMLButtonElement;
      t.addEventListener('click', () => {
        this.a.uiSound('click');
        this.worldTab = i;
        renderGrid();
      });
      tabs.appendChild(t);
    });
    s.append(tabs, desc, grid);
    renderGrid();
  }

  // ---------------------------------------------------------------- modals

  private openModal(name: string, build: (m: HTMLDivElement) => void, onClose: (() => void) | null = null): void {
    this.modalOpen = name;
    this.onModalClose = onClose;
    this.modal.innerHTML = '';
    this.modal.className = `modal panel ${name}`;
    build(this.modal);
    this.modalWrap.style.pointerEvents = 'auto';
    requestAnimationFrame(() => this.modalWrap.classList.add('show'));
  }

  closeModal(): void {
    if (!this.modalOpen) return;
    this.modalOpen = null;
    this.modalWrap.classList.remove('show');
    this.modalWrap.style.pointerEvents = 'none';
    const cb = this.onModalClose;
    this.onModalClose = null;
    if (cb) cb();
    // Any modal closing while the game is paused resumes it (resume is a no-op otherwise).
    else this.a.resume();
  }

  showPause(): void {
    this.openModal(
      'pause',
      (m) => {
        m.appendChild(el('h2', '', 'Paused'));
        const st = el('div', 'stack');
        st.append(
          this.button('Resume', () => this.closeModal(), 'primary', ICON.play),
          this.button('Restart level', () => {
            this.closeModal();
            this.a.restart();
          }, '', ICON.replay),
          this.button('Level select', () => {
            this.closeModal();
            this.a.openLevels();
          }, '', ICON.grid),
          this.button('Settings', () => this.showSettings(() => this.showPause()), '', ICON.gear),
          this.button('How to play', () => this.showHowTo(() => this.showPause()), '', ICON.help),
          this.button('Main menu', () => {
            this.closeModal();
            this.a.backToMenu();
          }, '', ICON.back),
        );
        m.appendChild(st);
      },
      () => this.a.resume(),
    );
  }

  showSettings(back?: () => void): void {
    const prevClose = this.onModalClose;
    this.onModalClose = null;
    this.openModal(
      'settings',
      (m) => {
        m.appendChild(el('h2', '', 'Settings'));
        const s = this.settings!;
        const wrap = el('div', '');
        const slider = (label: string, key: 'music' | 'sfx') => {
          const row = el('div', 'setting', `<label>${label}</label>`);
          const inp = el('input') as HTMLInputElement;
          inp.type = 'range';
          inp.min = '0';
          inp.max = '1';
          inp.step = '0.05';
          inp.value = String(s[key]);
          inp.addEventListener('input', () => {
            s[key] = Number(inp.value);
            this.a.settingsChanged(s);
          });
          row.appendChild(inp);
          wrap.appendChild(row);
        };
        const seg = <T extends string>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
          const row = el('div', 'setting', `<label>${label}</label>`);
          const sg = el('div', 'seg');
          const render = () => {
            sg.innerHTML = '';
            for (const [v, txt] of opts) {
              const b = el('button', get() === v ? 'on' : '', txt) as HTMLButtonElement;
              b.addEventListener('click', () => {
                this.a.uiSound('click');
                set(v);
                this.a.settingsChanged(s);
                render();
              });
              sg.appendChild(b);
            }
          };
          render();
          row.appendChild(sg);
          wrap.appendChild(row);
        };
        slider('Music', 'music');
        slider('Effects', 'sfx');
        seg('Graphics', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']], () => s.quality, (v) => (s.quality = v));
        seg('Camera follow', [['on', 'On'], ['off', 'Off']], () => (s.follow ? 'on' : 'off'), (v) => (s.follow = v === 'on'));
        seg('Screen shake', [['on', 'On'], ['off', 'Off']], () => (s.shake ? 'on' : 'off'), (v) => (s.shake = v === 'on'));
        seg('Auto hints', [['on', 'On'], ['off', 'Off']], () => (s.hints ? 'on' : 'off'), (v) => (s.hints = v === 'on'));
        m.appendChild(wrap);
        const row = el('div', 'row');
        row.style.marginTop = '18px';
        row.append(
          this.button('Done', () => (back ? back() : this.closeModal()), 'primary'),
          this.button('Reset progress', () => this.confirm('Reset all progress?', 'Stars and unlocked levels will be erased.', () => this.a.resetProgress(), () => this.showSettings(back))),
        );
        m.appendChild(row);
      },
      back ? null : prevClose,
    );
  }

  settings: Settings | null = null;

  confirm(title: string, text: string, yes: () => void, no?: () => void): void {
    this.openModal('confirm', (m) => {
      m.appendChild(el('h2', '', escapeHtml(title)));
      const p = el('p', '', escapeHtml(text));
      p.style.cssText = 'text-align:center;color:var(--muted);margin:0 0 20px;font-size:14px';
      m.appendChild(p);
      const row = el('div', 'row');
      row.append(
        this.button('Cancel', () => (no ? no() : this.closeModal())),
        this.button('Confirm', () => {
          this.closeModal();
          yes();
        }, 'primary'),
      );
      m.appendChild(row);
    });
  }

  showHowTo(back?: () => void): void {
    this.openModal('howto', (m) => {
      m.appendChild(el('h2', '', 'How to play'));
      const touch = matchMedia('(pointer: coarse)').matches;
      m.appendChild(
        el(
          'div',
          'howto',
          `<div>Guide the <b>energy sphere</b> from <b>START</b> to the glowing <b>GOAL</b>. Pick a component from the toolbar, place it on the board, then press <b>PLAY</b> and watch your machine run.</div>
          <div>Pieces snap to their neighbours automatically — <b>green dots</b> mean a connection. Rails that light up are linked to the start.</div>
          <div><b>★</b> reach the goal &nbsp; <b>★★</b> stay within the part limit &nbsp; <b>★★★</b> also beat the level's challenge.</div>
          ${
            touch
              ? `<div class="keys"><kbd>Tap</kbd><span>Place / select</span><kbd>Drag a piece</kbd><span>Move it</span><kbd>Drag</kbd><span>Move camera</span><kbd>Two fingers</kbd><span>Rotate & pinch to zoom</span></div>`
              : `<div class="keys"><kbd>Left click</kbd><span>Place / select</span><kbd>Drag a piece</kbd><span>Move it (or G)</span><kbd>Right / middle drag</kbd><span>Orbit camera</span><kbd>Shift + drag</kbd><span>Pan</span><kbd>Wheel</kbd><span>Zoom</span><kbd>R</kbd><span>Rotate / cycle placement</span><kbd>[ ]</kbd><span>Lower / raise selected</span><kbd>Del</kbd><span>Remove</span><kbd>Z</kbd><span>Undo</span><kbd>Space</kbd><span>Play / stop</span><kbd>1–9</kbd><span>Pick component</span></div>`
          }`,
        ),
      );
      const row = el('div', 'row');
      row.style.marginTop = '20px';
      row.append(this.button('Got it', () => (back ? back() : this.closeModal()), 'primary'));
      m.appendChild(row);
    });
  }

  showComplete(info: CompleteInfo, sound: (i: number) => void): void {
    this.openModal('complete', (m) => {
      m.appendChild(el('h2', '', 'Level complete'));
      const stars = el('div', 'big-stars', [0, 1, 2].map(() => `<i>${ICON.star}</i>`).join(''));
      m.appendChild(stars);
      const ok = (b: boolean) => `<i class="${b ? 'ok' : 'no'}">${b ? ICON.check : ICON.close}</i>`;
      m.appendChild(
        el(
          'div',
          'stats',
          `<div class="stat"><span>Time</span><span>${info.time.toFixed(2)}s${info.newBest && !info.firstTime ? '<span class="badge">BEST</span>' : ''}</span></div>
          <div class="stat"><span>Components</span><span>${info.used} / ${info.par} ${ok(info.used <= info.par)}</span></div>
          <div class="stat"><span>${escapeHtml(info.challenge)}</span><span>${ok(info.challengeMet)}</span></div>
          ${info.coins > 0 ? `<div class="stat earned"><span>${CURRENCY} earned</span><span class="coins"><i>${ICON.cog}</i>+<b class="amt">${info.coins}</b></span></div>` : ''}`,
        ),
      );
      if (info.coins > 0 && info.canDouble) {
        const dbl = this.button(`Watch ad · Double to ${info.coins * 2}`, () => {
          dbl.disabled = true;
          dbl.querySelector('span')!.textContent = 'Loading ad…';
          this.a.doubleReward();
        }, 'double-btn', ICON.play);
        m.appendChild(dbl);
      }
      const row = el('div', 'row');
      if (info.hasNext) row.append(this.button('Next level', () => this.a.nextLevel(), 'primary', ICON.next));
      row.append(this.button('Replay', () => this.a.replay(), '', ICON.replay), this.button('Levels', () => this.a.openLevels(), '', ICON.grid));
      m.appendChild(row);
      const items = stars.querySelectorAll('i');
      for (let i = 0; i < info.stars; i++) {
        setTimeout(() => {
          items[i].classList.add('on');
          sound(i);
        }, 450 + i * 380);
      }
    });
  }

  /** Large cinematic title shown when entering a new world. */
  banner(kicker: string, title: string): void {
    const b = el('div', 'banner', `<div class="bk">${escapeHtml(kicker)}</div><div class="bt">${escapeHtml(title)}</div>`);
    this.root.appendChild(b);
    requestAnimationFrame(() => b.classList.add('show'));
    setTimeout(() => b.classList.remove('show'), 1900);
    setTimeout(() => b.remove(), 2600);
  }

  /** Result of a rewarded ad on the complete screen. */
  setDoubled(ok: boolean, total: number): void {
    const btn = this.modal.querySelector('.double-btn') as HTMLButtonElement | null;
    const amt = this.modal.querySelector('.stat.earned .amt');
    if (ok && amt) amt.textContent = String(total);
    if (!btn) return;
    if (ok) {
      btn.querySelector('span')!.textContent = 'Doubled!';
      btn.classList.add('done');
    } else {
      btn.disabled = false;
      btn.querySelector('span')!.textContent = 'Ad unavailable — try again';
    }
  }

  // ---------------------------------------------------------------- shop & daily

  showShop(view: ShopView): void {
    const scroll = this.modalOpen === 'shop' ? (this.modal.querySelector('.shop-grid') as HTMLElement | null)?.scrollTop ?? 0 : 0;
    this.openModal('shop', (m) => {
      m.appendChild(el('h2', '', 'Shop'));
      const bar = el('div', 'shop-bar', `<span class="wallet-chip static"><i>${ICON.cog}</i><span>${view.coins}</span></span><span class="shop-note">Earn ${CURRENCY} by clearing levels, earning stars and claiming daily rewards.</span>`);
      m.appendChild(bar);
      const grid = el('div', 'shop-grid');
      for (const s of view.skins) {
        const owned = view.owned.includes(s.id);
        const equipped = view.equipped === s.id;
        const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
        const card = el('div', `skin-card ${equipped ? 'equipped' : ''}`);
        card.innerHTML = `<div class="swatch ${s.hueCycle ? 'prism' : ''}" style="--c:${hex(s.color)};--g:${hex(s.glow)};--t:${hex(s.trail)}"></div>
          <div class="sk-name">${escapeHtml(s.name)}</div><div class="sk-blurb">${escapeHtml(s.blurb)}</div>`;
        let btn: HTMLButtonElement;
        if (equipped) {
          btn = el('button', 'btn small', '<span>Equipped</span>') as HTMLButtonElement;
          btn.disabled = true;
        } else if (owned) {
          btn = this.button('Equip', () => this.a.equipSkin(s.id), 'small');
        } else {
          btn = this.button(String(s.price), () => this.a.buySkin(s.id), `small buy ${view.coins < s.price ? 'poor' : 'primary'}`, ICON.cog);
        }
        card.appendChild(btn);
        grid.appendChild(card);
      }
      m.appendChild(grid);
      const row = el('div', 'row');
      row.style.marginTop = '16px';
      row.append(this.button('Daily reward', () => this.a.openDaily(), '', ICON.gift), this.button('Close', () => this.closeModal(), 'primary'));
      m.appendChild(row);
    });
    requestAnimationFrame(() => {
      const g = this.modal.querySelector('.shop-grid') as HTMLElement | null;
      if (g) g.scrollTop = scroll;
    });
  }

  showDaily(status: DailyStatus, streak: number, onClaim: () => void): void {
    this.openModal('daily', (m) => {
      m.appendChild(el('h2', '', 'Daily reward'));
      const p = el('p', 'daily-note', status.available ? (status.reset ? 'Your streak restarted — come back every day to climb the calendar.' : 'Come back every day for bigger rewards.') : `Claimed! Streak: ${streak} day${streak === 1 ? '' : 's'}. Come back tomorrow.`);
      m.appendChild(p);
      const cal = el('div', 'daily-cal');
      DAILY_REWARDS.forEach((r, i) => {
        const claimed = status.available ? i < status.index : i <= status.index;
        const today = i === status.index;
        cal.appendChild(el('div', `day ${claimed ? 'claimed' : ''} ${today && status.available ? 'today' : ''} ${i === DAILY_REWARDS.length - 1 ? 'big' : ''}`, `<div class="dn">Day ${i + 1}</div><i>${claimed ? ICON.check : ICON.cog}</i><div class="dr">${r}</div>`));
      });
      m.appendChild(cal);
      const row = el('div', 'row');
      row.style.marginTop = '18px';
      if (status.available) row.append(this.button(`Claim ${status.reward}`, onClaim, 'primary', ICON.gift));
      row.append(this.button('Close', () => this.closeModal()));
      m.appendChild(row);
    });
  }

  // ---------------------------------------------------------------- toast / tips

  toast(text: string, kind: 'info' | 'bad' | 'hint' = 'info', ms = 2800): void {
    const ic = kind === 'bad' ? ICON.close : kind === 'hint' ? ICON.hint : ICON.check;
    this.toastEl.className = `toast panel ${kind}`;
    this.toastEl.innerHTML = `<i class="ti">${ic}</i><span>${escapeHtml(text)}</span>`;
    requestAnimationFrame(() => this.toastEl.classList.add('show'));
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  hideToast(): void {
    this.toastEl.classList.remove('show');
  }

  tip(html: string | null, ms = 0): void {
    window.clearTimeout(this.tipTimer);
    if (!html) {
      this.tipEl.classList.remove('show');
      return;
    }
    this.tipEl.innerHTML = html;
    this.tipEl.classList.add('show');
    if (ms) this.tipTimer = window.setTimeout(() => this.tipEl.classList.remove('show'), ms);
  }
}
