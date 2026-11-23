// The city's light rig: one directional key light whose shadow box follows the player,
// a hemisphere light for the sky fill, a reflection environment rebuilt from the same
// atmosphere colours, fog and exposure.

import * as THREE from 'three';
import { damp } from '../core/random.js';

const SHADOW_SIZE = 2048;
// Half-width of the shadow box around the player, in metres. Big enough to cover the
// street and the facades on both sides, small enough that a 2048 map stays sharp.
const SHADOW_HALF = 46;
const KEY_DISTANCE = 150;
// Rebuild the reflection environment when the sky has actually moved this much.
const ENV_DAYLIGHT_STEP = 0.02;
const ENV_MOON_STEP = 0.6;
const ENV_MAX_WAIT = 4;

export function createLighting(renderer, scene, opts = {}) {
  const quality = opts.quality || 'full';
  const fog = new THREE.Fog(0xccdcee, 55, quality === 'full' ? 980 : 620);
  scene.fog = fog;

  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.name = 'key-light';
  key.castShadow = quality !== 'off';
  key.shadow.mapSize.set(quality === 'lite' ? 1024 : SHADOW_SIZE, quality === 'lite' ? 1024 : SHADOW_SIZE);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.035;
  const cam = key.shadow.camera;
  cam.left = -SHADOW_HALF; cam.right = SHADOW_HALF;
  cam.top = SHADOW_HALF; cam.bottom = -SHADOW_HALF;
  cam.near = 1; cam.far = KEY_DISTANCE * 3;
  cam.updateProjectionMatrix();
  const target = new THREE.Object3D();
  scene.add(target);
  key.target = target;
  scene.add(key);

  const hemi = new THREE.HemisphereLight(0xdfe9f2, 0x9c9382, 1.2);
  hemi.name = 'sky-fill';
  scene.add(hemi);

  // A low sun grazes the road at ~14°, so the directional term contributes almost nothing
  // to the ground and the near asphalt collapsed to near-black at 18:00. This warm bounce
  // stands in for light coming back off a whole city of lit facades — it is the difference
  // between "dusk street" and "hole in the ground".
  const bounce = new THREE.AmbientLight(0xffd9b4, 0.3);
  bounce.name = 'city-bounce';
  scene.add(bounce);

  // ---------------------------------------------------------------- env map
  const EQ_W = 160, EQ_H = 80;
  const envCanvas = document.createElement('canvas');
  envCanvas.width = EQ_W; envCanvas.height = EQ_H;
  const envCtx = envCanvas.getContext('2d');
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let envRT = null;
  let envDaylight = -1, envMoon = -9, envAge = 999;

  const css = (c, k = 1) =>
    `rgb(${Math.round(Math.min(255, c.r * 255 * k))},${Math.round(Math.min(255, c.g * 255 * k))},${Math.round(Math.min(255, c.b * 255 * k))})`;

  function paintEnv(s) {
    const g = envCtx.createLinearGradient(0, 0, 0, EQ_H);
    g.addColorStop(0.00, css(s.zenith));
    g.addColorStop(0.34, css(s.zenith, 0.92).replace('rgb', 'rgb'));
    g.addColorStop(0.50, css(s.horizon));
    g.addColorStop(0.56, css(s.ground));
    g.addColorStop(1.00, css(s.ground, 0.55));
    envCtx.fillStyle = g;
    envCtx.fillRect(0, 0, EQ_W, EQ_H);

    // sun / moon blob so glossy glass catches something
    const body = s.daylight > 0.08 ? s.sunDir : s.moonDir;
    const u = (0.5 + Math.atan2(body.z, body.x) / (Math.PI * 2)) * EQ_W;
    const v = (0.5 - Math.asin(THREE.MathUtils.clamp(body.y, -1, 1)) / Math.PI) * EQ_H;
    const r = 26;
    const rg = envCtx.createRadialGradient(u, v, 0, u, v, r);
    rg.addColorStop(0, css(s.daylight > 0.08 ? s.sunColor : s.moonColor, 1.6));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    envCtx.fillStyle = rg;
    envCtx.fillRect(u - r, v - r, r * 2, r * 2);
  }

  function rebuildEnv(s) {
    paintEnv(s);
    envTex.needsUpdate = true;
    const rt = pmrem.fromEquirectangular(envTex);
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    scene.environmentIntensity = s.env;
    envDaylight = s.daylight;
    envMoon = s.moonUp;
    envAge = 0;
  }

  let appliedExposure = -1;
  let fogNear = fog.near, fogFar = fog.far;

  return {
    key, hemi, bounce, fog,
    /** @param {number} dt seconds @param {{x:number,z:number}} focus where the shadow should be centred */
    update(s, dt, focus) {
      // --- key light
      key.color.copy(s.lightColor);
      key.intensity = s.lightIntensity;
      if (focus) {
        const fx = Math.round(focus.x / 2) * 2;
        const fz = Math.round(focus.z / 2) * 2;
        target.position.set(fx, 0, fz);
        target.updateMatrixWorld();
        key.position.set(fx + s.keyDir.x * KEY_DISTANCE, s.keyDir.y * KEY_DISTANCE, fz + s.keyDir.z * KEY_DISTANCE);
      }

      // --- fill
      hemi.color.copy(s.hemiSky);
      hemi.groundColor.copy(s.hemiGround);
      hemi.intensity = s.hemiIntensity;
      // The key light was pulled down and this fill pushed up: the pair now carries the same
      // overall level with a gentler ratio, so sun-facing walls stop glaring and the shadow
      // side keeps its detail.
      bounce.color.copy(s.lightColor).lerp(s.hemiSky, 0.45);
      bounce.intensity = 0.21 + 0.50 * s.warm + 0.23 * s.night;

      // --- fog + exposure
      fog.color.copy(s.fog);
      // Night air is thicker: lamps bloom, far towers vanish.
      const near = 40 + 30 * s.night;
      const far = (quality === 'full' ? 980 : 620) * (1 - 0.42 * s.night);
      fogNear = damp(fogNear, near, 3, dt);
      fogFar = damp(fogFar, far, 3, dt);
      fog.near = fogNear; fog.far = fogFar;

      if (Math.abs(s.exposure - appliedExposure) > 0.002) {
        renderer.toneMappingExposure = s.exposure;
        appliedExposure = s.exposure;
      }

      // --- environment (expensive; only when the sky has visibly changed)
      envAge += dt;
      const changed =
        Math.abs(s.daylight - envDaylight) > ENV_DAYLIGHT_STEP ||
        Math.abs(s.moonUp - envMoon) > ENV_MOON_STEP ||
        envAge > ENV_MAX_WAIT;
      if (changed || !envRT) rebuildEnv(s);
      else scene.environmentIntensity = s.env;
    },
    dispose() {
      if (envRT) envRT.dispose();
      envTex.dispose();
      pmrem.dispose();
      key.shadow.map?.dispose();
      key.dispose();
      hemi.dispose();
      bounce.dispose();
    }
  };
}