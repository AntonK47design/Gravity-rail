import * as THREE from 'three';
import { glowTexture } from './materials';

/**
 * Pooled particle sparks + expanding rings. One draw call for all sparks,
 * a handful of reusable ring meshes. Deterministic pseudo-random so effects
 * look the same every run (and cost nothing to seed).
 */
export class Effects {
  private readonly max = 600;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private head = 0;
  private points: THREE.Points;
  private rings: { mesh: THREE.Mesh; t: number; dur: number; scale: number }[] = [];
  private seed = 1;
  density = 1;

  constructor(private scene: THREE.Scene) {
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a, t.a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setViewportHeight(h: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.9;
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  burst(p: THREE.Vector3 | { x: number; y: number; z: number }, color: number, count: number, speed = 2, size = 0.12, life = 0.8, up = 1): void {
    const n = Math.max(1, Math.round(count * this.density));
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      const th = this.rnd() * Math.PI * 2;
      const ph = Math.acos(2 * this.rnd() - 1);
      const sp = speed * (0.35 + this.rnd() * 0.65);
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * up;
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.life[i] = this.maxLife[i] = life * (0.6 + this.rnd() * 0.4);
      this.baseSize[i] = size * (0.6 + this.rnd() * 0.6);
    }
  }

  /** A single drifting mote (trails, ambient energy). */
  mote(p: { x: number; y: number; z: number }, color: number, size = 0.08, life = 0.5): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const c = new THREE.Color(color);
    this.pos[i * 3] = p.x + (this.rnd() - 0.5) * 0.05;
    this.pos[i * 3 + 1] = p.y + (this.rnd() - 0.5) * 0.05;
    this.pos[i * 3 + 2] = p.z + (this.rnd() - 0.5) * 0.05;
    this.vel[i * 3] = (this.rnd() - 0.5) * 0.2;
    this.vel[i * 3 + 1] = 0.15;
    this.vel[i * 3 + 2] = (this.rnd() - 0.5) * 0.2;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.life[i] = this.maxLife[i] = life;
    this.baseSize[i] = size;
  }

  ring(p: { x: number; y: number; z: number }, color: number, scale = 1.6, dur = 0.6, vertical = false): void {
    let r = this.rings.find((x) => x.t >= x.dur);
    if (!r) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.5, 48),
        new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      this.scene.add(mesh);
      r = { mesh, t: 0, dur, scale };
      this.rings.push(r);
    }
    r.t = 0;
    r.dur = dur;
    r.scale = scale;
    r.mesh.visible = true;
    r.mesh.position.set(p.x, p.y, p.z);
    r.mesh.rotation.set(vertical ? 0 : -Math.PI / 2, 0, 0);
    (r.mesh.material as THREE.MeshBasicMaterial).color.set(color);
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    for (const r of this.rings) {
      r.t = r.dur;
      r.mesh.visible = false;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= 3.5 * dt;
      this.vel[i * 3] *= 0.985;
      this.vel[i * 3 + 2] *= 0.985;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.baseSize[i] * k;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    for (const r of this.rings) {
      if (r.t >= r.dur) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const e = 1 - (1 - k) ** 3;
      r.mesh.scale.setScalar(0.3 + e * r.scale);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
      if (k >= 1) r.mesh.visible = false;
    }
  }
}
