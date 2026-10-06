import * as THREE from 'three';
import { PALETTE, glowTexture } from './materials';

/** Backdrop, lighting and ambient atmosphere. */
export class Environment {
  readonly key: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private rim: THREE.DirectionalLight;
  private dust: THREE.Points;
  private sky: THREE.Mesh;
  private floor: THREE.Mesh;
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(PALETTE.bgBottom);
    scene.fog = new THREE.Fog(PALETTE.bgBottom, 28, 70);

    // Gradient sky dome
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.bgTop) },
        bottom: { value: new THREE.Color(PALETTE.bgBottom) },
        accent: { value: new THREE.Color(0x24315a) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 accent; varying vec3 vP;
        void main(){ float h = clamp(vP.y*0.9+0.35,0.0,1.0); vec3 c = mix(bottom, top, h);
        float a = pow(max(0.0, dot(normalize(vP), normalize(vec3(-0.6,0.35,-0.7)))), 6.0);
        c += accent * a * 0.9; gl_FragColor = vec4(c,1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), skyMat);
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xc4d2ff, 0x262a3a, 1.2);
    scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff1dd, 2.1);
    this.key.position.set(-6, 12, 5);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    scene.add(this.key);
    scene.add(this.key.target);

    this.rim = new THREE.DirectionalLight(0x8fb3ff, 0.9);
    this.rim.position.set(8, 5, -9);
    scene.add(this.rim);

    // Soft round floor that fades into the backdrop
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, '#fff');
    grd.addColorStop(0.55, '#888');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(26, 48),
      new THREE.MeshStandardMaterial({ color: 0x121826, roughness: 0.95, transparent: true, alphaMap: tex, depthWrite: false }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.62;
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    // Drifting dust motes
    const n = 160;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 40;
      pos[i * 3 + 1] = rnd() * 12 - 1;
      pos[i * 3 + 2] = (rnd() - 0.5) * 40;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({ size: 0.09, map: glowTexture(), color: 0x8aa6ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    scene.add(this.dust);
  }

  /** Centre lights / floor on the playfield. */
  fit(box: THREE.Box3): void {
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.75 + 2;
    this.key.target.position.copy(c);
    this.key.position.set(c.x - 6, c.y + 12, c.z + 5);
    const cam = this.key.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 40;
    cam.updateProjectionMatrix();
    this.floor.position.x = c.x;
    this.floor.position.z = c.z;
    this.dust.position.set(c.x, 0, c.z);
  }

  setShadows(on: boolean, size: number): void {
    this.key.castShadow = on;
    if (this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    this.t += dt;
    this.sky.position.copy(camera.position);
    this.dust.rotation.y = this.t * 0.01;
    this.dust.position.y = Math.sin(this.t * 0.2) * 0.3;
  }
}
