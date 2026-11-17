import * as THREE from 'three';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  BlendFunction,
} from 'postprocessing';
import type { RenderContext } from './renderer';

/**
 * Cinematic post-processing tuned for phones, merged into a single full-screen pass:
 *  bloom -> AgX tone mapping -> grade -> vignette -> grain.
 * Ambient occlusion is not computed per frame: the room's AO is baked with its lighting, and
 * movable objects use soft contact shadows. That is cheaper and looks better on a phone.
 */
export interface PostPipeline {
  composer: EffectComposer;
  bloom: BloomEffect;
  grade: { saturation: HueSaturationEffect; contrast: BrightnessContrastEffect };
  vignette: VignetteEffect;
  render(dt: number): void;
}

export function createPostPipeline(ctx: RenderContext, scene: THREE.Scene): PostPipeline {
  const { renderer, camera } = ctx;
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 4,
  });

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.92,
    luminanceSmoothing: 0.25,
    intensity: 0.7,
    radius: 0.75,
  });
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const saturation = new HueSaturationEffect({ saturation: -0.12 });
  const contrast = new BrightnessContrastEffect({ contrast: 0.08, brightness: 0 });
  const vignette = new VignetteEffect({ offset: 0.22, darkness: 0.78 });
  const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
  grain.blendMode.opacity.value = 0.22;

  composer.addPass(new EffectPass(camera, bloom, toneMapping, saturation, contrast, vignette, grain));

  ctx.onResize((w, h) => composer.setSize(w, h, false));

  return {
    composer,
    bloom,
    grade: { saturation, contrast },
    vignette,
    render: (dt) => composer.render(dt),
  };
}
