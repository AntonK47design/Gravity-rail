import * as THREE from 'three';
import { BALL_R } from '../core/grid';
import { PALETTE, glowTexture } from './materials';

const TRAIL = 48;

/** The energy sphere: glowing core, halo, light and a fading light trail. */
export class BallView {
  readonly group = new THREE.Group();
  private core: THREE.Mesh;
  private shell: THREE.Mesh;
  private halo: THREE.Sprite;
  private light: THREE.PointLight;
  private trail: THREE.Points;
  private trailPos = new Float32Array(TRAIL * 3);
  private trailAlpha = new Float32Array(TRAIL);
  private trailHead = 0;
  private lastTrail = new THREE.Vector3();
  private roll = new THREE.Quaternion();
  private t = 0;
  private energy = 1;

  constructor(scene: THREE.Scene) {
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 20),
      new THREE.MeshStandardMaterial({ color: PALETTE.ball, emissive: PALETTE.ball, emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.1 }),
    );
    this.shell.castShadow = true;
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R * 1.04, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 }));
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7ee8ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halo.scale.setScalar(1.1);
    this.light = new THREE.PointLight(0x8beeff, 2.2, 3.2, 1.6);
    this.group.add(this.shell, this.core, this.halo, this.light);
    scene.add(this.group);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.trailAlpha, 1));
    this.trail = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { map: { value: glowTexture() }, color: { value: new THREE.Color(0x6fe6ff) }, scale: { value: 500 } },
        vertexShader: `attribute float alpha; varying float vA; uniform float scale;
          void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = (0.08 + 0.22*alpha) * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA;
          void main(){ float a = texture2D(map, gl_PointCoord).a * vA * 0.7; gl_FragColor = vec4(color * a, a); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);
    this.setVisible(false);
  }

  setViewportHeight(h: number): void {
    (this.trail.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.8;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
    this.trail.visible = v;
  }

  reset(p: { x: number; y: number; z: number }): void {
    this.group.position.set(p.x, p.y, p.z);
    this.lastTrail.copy(this.group.position);
    this.trailAlpha.fill(0);
    for (let i = 0; i < TRAIL; i++) this.trailPos.set([p.x, p.y, p.z], i * 3);
    this.energy = 1;
    this.group.scale.setScalar(1);
  }

  /** speed: current speed; dim (0..1) fades the sphere on failure. */
  update(dt: number, p: { x: number; y: number; z: number }, speed: number, dim = 0): void {
    this.t += dt;
    const prev = this.group.position.clone();
    this.group.position.set(p.x, p.y, p.z);
    const move = this.group.position.clone().sub(prev);
    const d = move.length();
    if (d > 1e-5 && d < 1) {
      const axis = new THREE.Vector3(move.z, 0, -move.x).normalize();
      if (axis.lengthSq() > 0.5) {
        this.roll.setFromAxisAngle(axis, d / 0.16);
        this.shell.quaternion.premultiply(this.roll);
        this.core.quaternion.premultiply(this.roll);
      }
    }
    // Brightness follows speed: the sphere visibly "charges up" when fast.
    const target = 1 - dim * 0.8;
    this.energy += (target - this.energy) * Math.min(1, dt * 6);
    const s = Math.min(1, speed / 6);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
    (this.shell.material as THREE.MeshStandardMaterial).emissiveIntensity = (1.2 + s * 1.4 + pulse * 0.2) * this.energy;
    this.halo.material.opacity = (0.55 + s * 0.4) * this.energy;
    this.halo.scale.setScalar(0.9 + s * 0.5 + pulse * 0.05);
    this.light.intensity = (1.6 + s * 2.2) * this.energy;

    // Trail: drop a point every ~3cm of travel
    if (this.group.position.distanceTo(this.lastTrail) > 0.03 || d > 0.5) {
      this.trailHead = (this.trailHead + 1) % TRAIL;
      this.trailPos.set([p.x, p.y, p.z], this.trailHead * 3);
      this.trailAlpha[this.trailHead] = 0.35 + s * 0.65;
      this.lastTrail.copy(this.group.position);
    }
    for (let i = 0; i < TRAIL; i++) this.trailAlpha[i] = Math.max(0, this.trailAlpha[i] - dt * 1.6);
    const g = this.trail.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Brief squash when something big happens. */
  pop(scale = 1.4): void {
    this.group.scale.setScalar(scale);
  }

  relax(dt: number): void {
    const s = this.group.scale.x;
    this.group.scale.setScalar(s + (1 - s) * Math.min(1, dt * 10));
  }
}
