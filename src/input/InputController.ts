import * as THREE from 'three';
import type { CameraController } from '../rendering/camera';

export interface InputHandler {
  hover(ndc: THREE.Vector2 | null): void;
  tap(ndc: THREE.Vector2, touch: boolean): void;
  cameraMoved(): void;
}

interface Ptr {
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  touch: boolean;
}

/**
 * Unified mouse + touch input on the canvas.
 *  Mouse: left = place/select (left-drag orbits), right/middle drag = orbit,
 *         shift+drag = pan, wheel = zoom.
 *  Touch: tap = place/select, one-finger drag = pan, two fingers = orbit + pinch zoom.
 */
export class InputController {
  private ptrs = new Map<number, Ptr>();
  private dragging = false;
  private gesture = false;
  private pinchDist = 0;
  private centroid = new THREE.Vector2();
  enabled = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: CameraController,
    private h: InputHandler,
    private viewportH: () => number,
  ) {
    canvas.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('pointerleave', () => {
      if (!this.ptrs.size) this.h.hover(null);
    });
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private ndc(x: number, y: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private down = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.canvas.focus?.();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const touch = e.pointerType !== 'mouse';
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, touch });
    if (touch && this.ptrs.size === 2) {
      this.gesture = true;
      const [a, b] = [...this.ptrs.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.centroid.set((a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  };

  private move = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const p = this.ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && e.target === this.canvas) this.h.hover(this.ndc(e.clientX, e.clientY));
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.gesture && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const c = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (this.pinchDist > 0) this.cam.zoom(this.pinchDist / Math.max(1, d));
      this.pinchDist = d;
      const cd = c.clone().sub(this.centroid);
      this.centroid.copy(c);
      this.cam.orbit(-cd.x * 0.008, cd.y * 0.006);
      this.h.cameraMoved();
      return;
    }

    const threshold = p.touch ? 10 : 5;
    if (!this.dragging && Math.hypot(p.x - p.sx, p.y - p.sy) > threshold) this.dragging = true;
    if (!this.dragging) {
      if (!p.touch) this.h.hover(this.ndc(e.clientX, e.clientY));
      return;
    }
    if (p.touch || e.shiftKey) this.cam.pan(dx, dy, this.viewportH());
    else this.cam.orbit(-dx * 0.008, dy * 0.006);
    this.h.cameraMoved();
  };

  private up = (e: PointerEvent): void => {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    const wasTap = !this.dragging && !this.gesture && (p.touch || p.button === 0);
    if (this.ptrs.size === 0) {
      this.dragging = false;
      this.gesture = false;
    } else if (this.ptrs.size === 1) {
      // Finishing a two-finger gesture: don't let the remaining finger pan abruptly.
      const rest = [...this.ptrs.values()][0];
      rest.sx = rest.x;
      rest.sy = rest.y;
      this.dragging = false;
    }
    if (wasTap && this.enabled) this.h.tap(this.ndc(e.clientX, e.clientY), p.touch);
    if (!p.touch) this.h.hover(this.ndc(e.clientX, e.clientY));
  };

  private cancel = (e: PointerEvent): void => {
    this.ptrs.delete(e.pointerId);
    if (!this.ptrs.size) {
      this.dragging = false;
      this.gesture = false;
    }
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (!this.enabled) return;
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.cam.zoom(Math.exp(d * 0.0012));
    this.h.cameraMoved();
  };

  reset(): void {
    this.ptrs.clear();
    this.dragging = false;
    this.gesture = false;
  }
}
