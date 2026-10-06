import * as THREE from 'three';

/**
 * Smooth orbit camera with framing, gentle follow and restrained shake.
 * All motion is critically damped toward "goal" values so input never feels
 * jumpy.
 */
export class CameraController {
  readonly target = new THREE.Vector3();
  private goalTarget = new THREE.Vector3();
  yaw = Math.PI / 4;
  pitch = 0.82;
  dist = 12;
  private goalYaw = this.yaw;
  private goalPitch = this.pitch;
  private goalDist = this.dist;
  private home = { target: new THREE.Vector3(), yaw: this.yaw, pitch: this.pitch, dist: this.dist };
  private shakeAmt = 0;
  private shakeT = 0;
  private followPoint: THREE.Vector3 | null = null;
  private followWeight = 0;
  minDist = 4;
  maxDist = 30;
  bounds = new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(10, 3, 10));
  shakeEnabled = true;
  /** Slow automatic orbit (menu backdrop). */
  autoOrbit = 0;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Screen-space margins (px) reserved for HUD chrome when framing. */
  insets = { top: 70, bottom: 110, left: 16, right: 16 };

  /**
   * Fit the playfield in the free screen area: binary-search the distance at
   * which every corner of the box projects inside the HUD-safe rectangle,
   * then nudge the target so the board is centred in that rectangle.
   */
  frame(box: THREE.Box3, instant = false, reset = true, yaw = Math.PI / 4 + 0.12): void {
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const pitch = 0.86;
    const cam = this.camera.clone() as THREE.PerspectiveCamera;
    const vw = Math.max(1, this.viewW);
    const vh = Math.max(1, this.viewH);
    const safe = {
      x0: (this.insets.left / vw) * 2 - 1,
      x1: 1 - (this.insets.right / vw) * 2,
      y0: (this.insets.bottom / vh) * 2 - 1,
      y1: 1 - (this.insets.top / vh) * 2,
    };
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y - 0.4, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const place = (target: THREE.Vector3, dist: number) => {
      const cp = Math.cos(pitch);
      cam.position.set(target.x + Math.sin(yaw) * cp * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * cp * dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
    };
    const extent = (target: THREE.Vector3, dist: number) => {
      place(target, dist);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const c of corners) {
        const p = c.clone().project(cam);
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
      return { x0, x1, y0, y1 };
    };
    const target = centre.clone();
    let dist = 10;
    for (let iter = 0; iter < 3; iter++) {
      let lo = 2;
      let hi = 80;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const e = extent(target, mid);
        const fits = e.x1 - e.x0 <= (safe.x1 - safe.x0) * 0.94 && e.y1 - e.y0 <= (safe.y1 - safe.y0) * 0.94;
        if (fits) hi = mid;
        else lo = mid;
      }
      dist = hi;
      // Re-centre: shift the target so the projected box centre sits in the safe-area centre.
      const e = extent(target, dist);
      const dx = (e.x0 + e.x1) / 2 - (safe.x0 + safe.x1) / 2;
      const dy = (e.y0 + e.y1) / 2 - (safe.y0 + safe.y1) / 2;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const worldPerNdc = dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      target.addScaledVector(right, dx * worldPerNdc * cam.aspect);
      target.addScaledVector(fwd, (dy * worldPerNdc) / Math.sin(pitch));
    }
    const radius = Math.max(size.x, size.z) * 0.62 + 1.2;
    this.bounds.copy(box).expandByScalar(2);
    this.minDist = Math.max(3.5, radius * 0.6);
    this.maxDist = Math.max(dist * 1.8, this.minDist + 4);
    this.home.target.copy(target);
    this.home.yaw = yaw;
    this.home.pitch = pitch;
    this.home.dist = dist;
    if (reset) this.resetView(instant);
    else this.goalDist = THREE.MathUtils.clamp(this.goalDist, this.minDist, this.maxDist);
  }

  viewW = 1280;
  viewH = 800;

  resetView(instant = false): void {
    this.goalTarget.copy(this.home.target);
    this.goalYaw = this.home.yaw;
    this.goalPitch = this.home.pitch;
    this.goalDist = this.home.dist;
    if (instant) {
      this.target.copy(this.goalTarget);
      this.yaw = this.goalYaw;
      this.pitch = this.goalPitch;
      this.dist = this.goalDist;
    }
  }

  /** Start slightly further out and swing in — a gentle reveal when a level opens. */
  flyIn(): void {
    this.dist = this.goalDist * 1.45;
    this.yaw = this.goalYaw - 0.5;
    this.pitch = Math.min(1.35, this.goalPitch + 0.25);
  }

  orbit(dYaw: number, dPitch: number): void {
    this.goalYaw += dYaw;
    this.goalPitch = THREE.MathUtils.clamp(this.goalPitch + dPitch, 0.25, 1.45);
  }

  zoom(factor: number): void {
    this.goalDist = THREE.MathUtils.clamp(this.goalDist * factor, this.minDist, this.maxDist);
  }

  /** Pan in screen space; dx/dy in pixels. */
  pan(dx: number, dy: number, viewportH: number): void {
    const scale = (this.dist * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / viewportH;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.goalTarget.addScaledVector(right, -dx * scale);
    this.goalTarget.addScaledVector(fwd, dy * scale * 1.3);
    this.goalTarget.clamp(this.bounds.min, this.bounds.max);
    this.goalTarget.y = this.home.target.y;
  }

  follow(p: THREE.Vector3 | null, weight = 0.35): void {
    this.followPoint = p;
    this.followWeight = weight;
  }

  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmt = Math.min(0.25, Math.max(this.shakeAmt, amount));
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 6.5);
    if (this.autoOrbit) this.goalYaw += this.autoOrbit * dt;
    const tgt = this.goalTarget.clone();
    if (this.followPoint) tgt.lerp(this.followPoint, this.followWeight);
    this.target.lerp(tgt, 1 - Math.exp(-dt * 4));
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.dist += (this.goalDist - this.dist) * k;

    const cp = Math.cos(this.pitch);
    const offset = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);

    if (this.shakeAmt > 0.001) {
      this.shakeT += dt * 40;
      const a = this.shakeAmt;
      this.camera.position.x += Math.sin(this.shakeT * 1.3) * a * 0.5;
      this.camera.position.y += Math.sin(this.shakeT * 1.7 + 1) * a * 0.4;
      this.camera.position.z += Math.cos(this.shakeT * 1.1) * a * 0.5;
      this.shakeAmt *= Math.exp(-dt * 7);
    }
  }
}
