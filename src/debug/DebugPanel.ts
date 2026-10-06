import { applyPlacements } from '../core/level';
import type { Game } from '../game/Game';
import { LEVELS } from '../levels';

/**
 * Hidden developer tools. Only imported in dev builds (import.meta.env.DEV),
 * so none of this ships to production. Toggle with the backquote key (`).
 */
export function installDebug(game: Game): void {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;right:8px;top:70px;z-index:50;background:rgba(0,0,0,.82);color:#cfe;font:12px ui-monospace,monospace;padding:10px;border-radius:8px;display:none;flex-direction:column;gap:4px;width:230px;pointer-events:auto;border:1px solid #345';
  const info = document.createElement('pre');
  info.style.cssText = 'margin:6px 0 0;white-space:pre-wrap;font-size:11px;color:#9fd';
  const fps = document.createElement('div');
  fps.id = 'fps';
  fps.style.display = 'none';
  document.body.append(panel, fps);

  let showPaths = false;
  let showCoords = false;
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#1d2a3a;color:#cfe;border:1px solid #345;border-radius:4px;padding:4px 6px;text-align:left;cursor:pointer;font:inherit';
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    panel.appendChild(b);
  };
  const title = document.createElement('div');
  title.textContent = 'ORBITAL DEBUG';
  title.style.cssText = 'font-weight:bold;color:#7ee8ff;margin-bottom:4px';
  panel.appendChild(title);

  const loadSolution = (three: boolean) => {
    if (game.state !== 'build') return;
    game.builder.clear();
    const sol = three ? (game.level.challengeSolution ?? game.level.solution) : game.level.solution;
    applyPlacements(game.board, sol);
    game.builder.history.clear();
    game.refreshHud();
    game.view.sync();
  };

  btn('Load solution', () => loadSolution(false));
  btn('Load ★★★ solution', () => loadSolution(true));
  btn('Win level (skip)', () => {
    game.save.recordResult(game.level.id, 3, 1);
    game.nextLevel();
  });
  btn('Prev level', () => game.loadLevel(Math.max(0, game.levelIndex - 1)));
  btn('Next level', () => game.loadLevel(Math.min(LEVELS.length - 1, game.levelIndex + 1)));
  btn('Reload level', () => game.loadLevel(game.levelIndex));
  btn('Toggle collision paths', () => {
    showPaths = !showPaths;
    game.view.showPaths(showPaths);
  });
  btn('Toggle grid coords', () => {
    showCoords = !showCoords;
    game.view.showCoords(showCoords);
  });
  btn('Toggle FPS', () => (fps.style.display = fps.style.display === 'none' ? 'block' : 'none'));
  btn('Unlimited components', () => {
    game.builder.unlimited = !game.builder.unlimited;
    game.refreshHud();
  });
  btn('Unlock all levels', () => {
    game.builder.unlimited = true;
    game.refreshHud();
  });
  btn('Reset save data', () => {
    game.save.reset();
    location.reload();
  });
  panel.appendChild(info);

  window.addEventListener('keydown', (e) => {
    if (e.key === '`') panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });

  let frames = 0;
  let acc = 0;
  game.onFrame = (dt) => {
    frames++;
    acc += dt;
    if (acc > 0.5) {
      fps.textContent = `${Math.round(frames / acc)} fps · ${game.r.quality} · ${game.r.renderer.info.render.calls} calls`;
      frames = 0;
      acc = 0;
    }
    if (panel.style.display === 'none') return;
    const s = game.sim;
    info.textContent = [
      `level ${game.level.id} state ${game.state}`,
      `pieces ${game.board.pieces.size} used ${game.builder.usedCount()}`,
      s ? `sim ${s.mode} t=${s.time.toFixed(2)}` : 'sim —',
      s ? `pos ${s.pos.x.toFixed(2)} ${s.pos.y.toFixed(2)} ${s.pos.z.toFixed(2)}` : '',
      s ? `speed ${s.speed.toFixed(2)} v=${s.v.toFixed(2)} s=${s.s.toFixed(2)}` : '',
      s && s.mode === 'rail' ? `on piece ${s.path.pieceId} (${game.board.pieces.get(s.path.pieceId)?.type})` : '',
      s?.failReason ? `fail: ${s.failReason}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };
  (window as unknown as { game: Game }).game = game;
  console.info('[orbital] debug tools ready — press ` to toggle');
}
