import { CHANNEL_COLORS, PIECES } from '../core/components';
import type { Board } from '../core/board';
import type { SimEvent } from '../core/simulation';
import type { AudioEngine } from '../audio/AudioEngine';
import type { BallView } from '../rendering/BallView';
import type { BoardView } from '../rendering/BoardView';
import type { CameraController } from '../rendering/camera';
import type { Effects } from '../rendering/effects';

export interface FeedbackCtx {
  board: Board;
  view: BoardView;
  ball: BallView;
  fx: Effects;
  cam: CameraController;
  audio: AudioEngine | null;
}

/**
 * Translates simulation events into juice: particles, rings, sounds and
 * (sparingly) camera shake. Kept separate from the simulation so the core
 * stays headless and deterministic.
 */
export function playEvents(events: SimEvent[], c: FeedbackCtx): void {
  const sfx = c.audio?.sfx ?? null;
  for (const e of events) {
    switch (e.type) {
      case 'boost':
        c.fx.burst(e.pos, PIECES.booster.color, 4, 1.2, 0.09, 0.4, 0.6);
        c.view.flash(e.pieceId);
        sfx?.boost();
        break;
      case 'brake':
        c.fx.burst(e.pos, 0xffb36b, 4, 1.6, 0.06, 0.35, 0.8);
        sfx?.brake();
        break;
      case 'bounce':
        c.fx.burst(e.pos, 0xffffff, 6, 1.2, 0.06, 0.3);
        c.view.flash(e.pieceId);
        sfx?.bounce(e.speed);
        break;
      case 'switch': {
        const col = CHANNEL_COLORS[e.channel % CHANNEL_COLORS.length];
        c.view.flash(e.pieceId);
        c.fx.ring(e.pos, col, 1.4, 0.5);
        for (const p of c.board.pieces.values()) {
          if ((p.type === 'gate' || p.type === 'splitter') && (p.props.channel ?? 0) === e.channel) {
            c.view.flash(p.id);
            c.fx.burst({ x: p.x, y: e.pos.y + 0.1, z: p.z }, col, 8, 1, 0.08, 0.4);
          }
        }
        sfx?.switch();
        sfx?.gate_();
        break;
      }
      case 'teleport':
        c.fx.burst(e.from, PIECES.teleporter.color, 16, 1.8, 0.1, 0.5);
        c.fx.burst(e.to, PIECES.teleporter.color, 16, 1.8, 0.1, 0.5);
        c.fx.ring(e.to, 0xc4b5fd, 1, 0.4, true);
        c.ball.pop(1.35);
        sfx?.teleport();
        break;
      case 'launch':
        c.fx.burst(e.pos, PIECES.launcher.color, 18, 2.4, 0.1, 0.5);
        c.fx.ring(e.pos, PIECES.launcher.color, 1.2, 0.4);
        c.cam.shake(0.05);
        c.ball.pop(1.25);
        sfx?.launch();
        break;
      case 'land':
        c.fx.burst(e.pos, 0x9ff3ff, Math.min(14, 4 + e.impact * 2), 1 + e.impact * 0.2, 0.07, 0.35, 0.6);
        if (e.impact > 3) c.cam.shake(0.025);
        sfx?.land(e.impact);
        break;
      case 'catch':
        c.fx.ring(e.pos, PIECES[c.board.pieces.get(e.pieceId)?.type ?? 'collector'].color, 1.4, 0.5);
        c.view.flash(e.pieceId);
        sfx?.catch_();
        break;
      case 'derail':
        c.fx.burst(e.pos, 0xffd27a, 14, 2, 0.08, 0.4);
        sfx?.bounce(5);
        break;
      case 'shard':
        c.fx.burst(e.pos, 0xf0abfc, 22, 2, 0.1, 0.6);
        c.fx.ring(e.pos, 0xf0abfc, 0.9, 0.4, true);
        c.view.markShard(e.index, true);
        sfx?.shard(e.index);
        break;
      case 'checkpoint':
        c.fx.ring(e.pos, 0xfef3c7, 1.4, 0.5, true);
        c.fx.burst(e.pos, 0xfef3c7, 16, 1.6, 0.1, 0.5);
        sfx?.checkpoint();
        break;
      case 'enter':
      case 'win':
      case 'fail':
        break;
    }
  }
}
