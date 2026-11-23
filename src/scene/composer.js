// Post chain: render (linear HDR) -> bloom -> tone map + sRGB encode.
//
// Bloom is what turns lit windows, street lamps and the sun halo into the soft glow the
// style lives on. Its strength is driven by the time of day: barely there at noon, strong
// after dark.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createComposer(renderer, scene, camera, opts = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: opts.samples ?? 4
  });

  const composer = new EffectComposer(renderer, target);
  composer.setSize(size.x, size.y);
  composer.setPixelRatio(renderer.getPixelRatio());

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.42,   // strength
    0.72,   // radius
    0.80    // threshold
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let applied = { strength: -1, radius: -1 };

  return {
    composer,
    bloom,
    render() { composer.render(); },
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    update(s) {
      // Dusk and night want halos; midday wants a clean image. The night number is kept
      // low on purpose: everything emissive in this city is already bright, and a strong
      // bloom pass on top of it turns the shop signs and street lamps into white blobs.
      // Wider and weaker than before: the halo should be a breath around a lamp, not a
      // white disc. A higher threshold keeps mid-bright concrete and glass out of it
      // entirely, which is where most of the "too harsh" came from.
      const strength = 0.19 + 0.29 * s.night + 0.09 * s.warm;
      const radius = 0.68 + 0.08 * s.night;
      if (Math.abs(strength - applied.strength) > 0.01) {
        bloom.strength = strength;
        applied.strength = strength;
      }
      if (Math.abs(radius - applied.radius) > 0.01) {
        bloom.radius = radius;
        applied.radius = radius;
      }
      // Only genuinely bright pixels bloom: neon signs, lamp heads, the sun.
      bloom.threshold = 0.84 + 0.10 * (1 - s.night);
    },
    dispose() {
      composer.dispose();
      bloom.dispose();
      target.dispose();
    }
  };
}