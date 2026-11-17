import * as THREE from 'three';

/** Highest device pixel ratio we render at. iPhones report 3; 2 is visually near-identical and far cheaper. */
export const MAX_PIXEL_RATIO = 2;

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Current stage size in CSS pixels. */
  size: { width: number; height: number };
  /** Stage element: the full screen on phones, a portrait phone frame on laptops. */
  stage: HTMLElement;
  /** Called after every resize with the new CSS size and pixel ratio. */
  onResize(cb: (width: number, height: number, pixelRatio: number) => void): void;
}

export function createRenderContext(canvas: HTMLCanvasElement, stage: HTMLElement): RenderContext {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // the post-processing composer does its own multisampling
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in post-processing
  renderer.toneMappingExposure = 0.9;
  renderer.setClearColor(0x030406, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft via light.shadow.radius

  const camera = new THREE.PerspectiveCamera(50, 1, 0.03, 40);
  const size = { width: 0, height: 0 };
  const listeners: ((w: number, h: number, pr: number) => void)[] = [];

  const resize = () => {
    const width = Math.max(1, Math.round(stage.clientWidth));
    const height = Math.max(1, Math.round(stage.clientHeight));
    if (width === size.width && height === size.height) return;
    size.width = width;
    size.height = height;
    const pr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(pr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    for (const cb of listeners) cb(width, height, pr);
  };

  new ResizeObserver(resize).observe(stage);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  return {
    renderer,
    camera,
    size,
    stage,
    onResize(cb) {
      listeners.push(cb);
      if (size.width > 0) cb(size.width, size.height, renderer.getPixelRatio());
    },
  };
}
