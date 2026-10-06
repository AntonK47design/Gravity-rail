import './ui/styles.css';
import { Game } from './game/Game';
import { createPlatform } from './platform';
import { Persistence } from './save/persistence';

async function boot(): Promise<void> {
  const loader = document.getElementById('loader');
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const platform = await createPlatform();
  platform.loadingStart();
  const save = new Persistence();
  let game: Game;
  try {
    game = new Game(canvas, platform, save);
  } catch (e) {
    console.error(e);
    if (loader) loader.innerHTML = '<div class="ld-err">ORBITAL needs WebGL to run.<br/>Please try another browser or device.</div>';
    return;
  }
  game.start();
  platform.loadingStop();
  if (loader) {
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 700);
  }
  if (import.meta.env.DEV) {
    const { installDebug } = await import('./debug/DebugPanel');
    installDebug(game);
  }
  window.addEventListener('pagehide', () => save.flush());
}

boot().catch((e) => console.error('[orbital] boot failed', e));
