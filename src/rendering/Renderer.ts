import * as THREE from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { CameraController } from './camera';
import { Environment } from './environment';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityProfile {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  particles: number;
  antialias: boolean;
}

export function qualityProfile(q: Quality): QualityProfile {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  switch (q) {
    case 'low':
      return { pixelRatio: Math.min(dpr, 1), shadows: false, shadowMapSize: 512, bloom: false, particles: 0.4, antialias: false };
    case 'medium':
      return { pixelRatio: Math.min(dpr, 1.5), shadows: true, shadowMapSize: 1024, bloom: false, particles: 0.7, antialias: true };
    case 'high':
      return { pixelRatio: Math.min(dpr, 2), shadows: true, shadowMapSize: 2048, bloom: true, particles: 1, antialias: true };
  }
}

/** Picks a sensible default from cheap device heuristics. */
export function detectQuality(): Quality {
  try {
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    if (mobile) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
    if (cores <= 2 || mem <= 2) return 'low';
    if (cores >= 6) return 'high';
    return 'medium';
  } catch {
    return 'medium';
  }
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly cam: CameraController;
  readonly env: Environment;
  profile: QualityProfile;
  quality: Quality;
  private composer: EffectComposer | null = null;
  private loadingComposer = false;
  private width = 1;
  private height = 1;

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.profile = qualityProfile(quality);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.profile.antialias, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.cam = new CameraController(this.camera);
    this.env = new Environment(this.scene);
    this.applyQuality(quality);
    this.resize();
  }

  applyQuality(q: Quality): void {
    this.quality = q;
    this.profile = qualityProfile(q);
    this.renderer.setPixelRatio(this.profile.pixelRatio);
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.env.setShadows(this.profile.shadows, this.profile.shadowMapSize);
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    if (this.profile.bloom) {
      if (!this.composer && !this.loadingComposer) void this.loadComposer();
    } else if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.resize();
  }

  /** Bloom is code-split: only High quality downloads the post-processing chain. */
  private async loadComposer(): Promise<void> {
    this.loadingComposer = true;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
      ]);
      if (!this.profile.bloom) return;
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.32, 0.35, 1.15));
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.resize();
    } catch (e) {
      console.warn('[render] bloom unavailable', e);
    } finally {
      this.loadingComposer = false;
    }
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.cam.viewW = w;
    this.cam.viewH = h;
    const narrow = w < 760;
    this.cam.insets = { top: narrow ? 100 : 70, bottom: narrow ? 160 : 110, left: 12, right: 12 };
    this.camera.fov = w / h < 0.8 ? 52 : 40;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.profile.pixelRatio);
      this.composer.setSize(w, h);
    }
  }

  get viewportHeight(): number {
    return this.height;
  }

  render(dt: number): void {
    this.cam.update(dt);
    this.env.update(dt, this.camera);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
