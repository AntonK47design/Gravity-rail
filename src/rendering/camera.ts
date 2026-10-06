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

  frame(box: THREE.Box3, instant = false, reset = true, yaw = Math.PI / 4 + 0.12): void {
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z) * 0.62 + size.y * 0.35 + 1.2;
    const aspect = this.camera.aspect;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = radius / Math.sin(fov / 2) / Math.min(1.25, Math.max(0.62, aspect * 0.85));
    this.bounds.copy(box).expandByScalar(2);
    this.minDist = Math.max(3.5, radius * 0.6);
    this.maxDist = fit * 1.8;
    this.home.target.copy(centre);
    this.home.yaw = yaw;
    this.home.pitch = 0.86;
    this.home.dist = fit * 0.92;
    if (reset) this.resetView(instant);
    else this.goalDist = THREE.MathUtils.clamp(this.goalDist, this.minDist, this.maxDist);
  }

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
    const k = 1 - Math.exp(-dt * 9);
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
