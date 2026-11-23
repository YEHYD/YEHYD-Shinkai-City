// The sky: an inside-out sphere shaded with the atmosphere's own colours, plus a star
// field and three drifting cloud decks.
//
// The dome is shaded by hand rather than with addons/Sky so that the horizon colour and
// the fog colour are literally the same numbers — that is the trick that makes the far
// towers dissolve into the sky with no seam.

import * as THREE from 'three';
import { cloudTexture, CLOUD_VARIANTS, glowTexture } from '../core/textures.js';
import { makeRandom, TAU } from '../core/random.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSunGlow;
uniform vec3 uWarmSky;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform float uWarm;
uniform float uStars;
uniform float uMoonUp;
uniform float uSunSize;
uniform float uTime;
uniform sampler2D uCloudTex;
uniform vec3 uCloudCol;
uniform float uCloudAmt;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec3 d = normalize(vDir);

  // Vertical gradient: haze at the horizon, deep blue overhead.
  float h = clamp(d.y, 0.0, 1.0);
  float t = pow(h, 0.42);
  vec3 col = mix(uHorizon, uZenith, t);

  // Below the horizon: fade into the ground haze.
  col = mix(col, uGround, smoothstep(0.0, -0.25, d.y));

  // --- horizon cloud bands, drawn into the dome itself
  // The mesh decks above the city cannot help here: from pavement level the sky you
  // actually see down a street is the wedge *below* ~14°, and a deck at 700 m only
  // reaches that low once it is thousands of metres across. Painting the bands in the
  // dome keeps them at every camera height and every pitch, which is what makes the
  // sunset sky read as a sky and not as a smooth gradient.
  //
  // Project the view ray onto a flat sheet overhead instead of sampling by azimuth:
  // that is what a real cloud deck looks like, with the puffs shrinking and stacking
  // up towards the horizon, and it stops the texture from reading as tiles.
  vec2 cp = d.xz / max(d.y, 0.075) * 0.26;
  float c1 = texture2D(uCloudTex, cp * 1.0 + vec2(uTime * 0.0006, 0.0)).a;
  float c2 = texture2D(uCloudTex, cp * 2.7 + vec2(-uTime * 0.0011, 0.37)).a;
  float c3 = texture2D(uCloudTex, cp * 6.1 + vec2(uTime * 0.0018, 0.71)).a;
  // A slow, large-scale mask punches gaps in the sheet: without it the bands clamp to
  // full coverage and the sky turns into a flat white lid instead of a sky.
  float mask = texture2D(uCloudTex, cp * 0.34 + vec2(0.21, 0.07)).a;
  float cover = c1 * 0.60 + c2 * 0.30 + c3 * 0.14;
  cover = smoothstep(0.16, 0.70, cover);
  cover *= smoothstep(0.24, 0.58, mask + 0.10);
  // keep a clear band right at the horizon and let the deck thin out overhead
  cover *= smoothstep(-0.01, 0.06, d.y) * (1.0 - smoothstep(0.22, 0.55, d.y));
  float sunVis = 1.0 - cover * 0.62;

  // --- the sun: a wide halo, a warm band along the horizon, and the disc itself
  float cosA = dot(d, uSunDir);
  float ang = acos(clamp(cosA, -1.0, 1.0));

  float halo = pow(max(cosA, 0.0), 7.0);
  col += uSunGlow * halo * (0.22 + 0.85 * uWarm) * sunVis;

  // A broad, low, warm wash where the sun meets the horizon.
  float lowBand = (1.0 - t) * (1.0 - t);
  col += uWarmSky * pow(max(cosA, 0.0), 2.2) * lowBand * (0.10 + 0.55 * uWarm) * sunVis;

  // The disc: white-gold high up, deep orange when it is near the horizon.
  float disc = 1.0 - smoothstep(uSunSize * 0.80, uSunSize, ang);
  col += uSunColor * disc * 6.0 * (1.0 - cover * 0.85);

  // Clouds last, so they occlude the halo instead of being washed out by it.
  col = mix(col, uCloudCol, cover * uCloudAmt);

  // --- the moon: a small disc with a soft halo, only while it is up
  float moonAng = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  float moon = 1.0 - smoothstep(0.012, 0.020, moonAng);
  float moonHalo = pow(max(dot(d, uMoonDir), 0.0), 220.0);
  col += uMoonColor * (moon * 2.2 + moonHalo * 0.35) * uMoonUp;

  // --- stars, faded in by night and hidden behind the sun's glow
  if (uStars > 0.001) {
    vec2 sc = d.xz / max(abs(d.y) + 0.08, 0.08);
    vec2 cell = floor(sc * 46.0);
    float rnd = hash(cell);
    float star = step(0.9955, rnd);
    vec2 off = fract(sc * 46.0) - 0.5;
    float size = 0.18 + (rnd - 0.9955) * 60.0;
    float mask = 1.0 - smoothstep(0.0, size, length(off));
    float twinkle = 0.65 + 0.35 * hash(cell + floor(uTime * 1.7));
    col += vec3(0.86, 0.90, 1.0) * star * mask * twinkle * uStars * 1.6 * smoothstep(0.02, 0.22, d.y);
  }

  // Dither: long smooth gradients band badly on 8-bit output.
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.0028;

  gl_FragColor = vec4(col, 1.0);
}`;

const SKY_RADIUS = 3200;

export function createSky(scene) {
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color('#fff4e0') },
    uSunGlow: { value: new THREE.Color('#ffd7a8') },
    uWarmSky: { value: new THREE.Color('#ff8b4c') },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonColor: { value: new THREE.Color('#e9eef8') },
    uWarm: { value: 0 },
    uStars: { value: 0 },
    uMoonUp: { value: 0 },
    uSunSize: { value: 0.012 },
    uTime: { value: 0 },
    uCloudTex: { value: null },
    uCloudCol: { value: new THREE.Color('#fff2e4') },
    uCloudAmt: { value: 0.85 }
  };

  // One tiling copy of the cloud sheet for the dome bands; the decks use their own
  // clones because they need a different repeat.
  const bandTex = cloudTexture(1).clone();
  bandTex.wrapS = bandTex.wrapT = THREE.RepeatWrapping;
  bandTex.generateMipmaps = true;
  bandTex.minFilter = THREE.LinearMipmapLinearFilter;
  bandTex.magFilter = THREE.LinearFilter;
  // The projection stretches hard towards the horizon; without anisotropy the sheet
  // smears into visible streaks along the ground line.
  bandTex.anisotropy = 8;
  bandTex.needsUpdate = true;
  uniforms.uCloudTex.value = bandTex;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 48, 32),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true
    })
  );
  dome.name = 'sky-dome';
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  scene.add(dome);

  // ---------------------------------------------------------------- stars
  const starGroup = new THREE.Group();
  starGroup.name = 'stars';
  const rnd = makeRandom(31337);
  const COUNT = 1500;
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    // cosine-weighted over the upper hemisphere only
    const u = rnd.next();
    const y = Math.pow(u, 0.65);
    const a = rnd.next() * TAU;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    pos[i * 3] = Math.cos(a) * r * SKY_RADIUS * 0.86;
    pos[i * 3 + 1] = y * SKY_RADIUS * 0.86;
    pos[i * 3 + 2] = Math.sin(a) * r * SKY_RADIUS * 0.86;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: 0xdce6ff, size: 2.6, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false
    })
  );
  stars.renderOrder = -99;
  stars.frustumCulled = false;
  starGroup.add(stars);
  scene.add(starGroup);

  // ---------------------------------------------------------------- sun halo
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,246,226,0.95)', 'rgba(255,150,80,0)'),
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false
  }));
  halo.renderOrder = -98;
  halo.scale.setScalar(900);
  scene.add(halo);

  // ---------------------------------------------------------------- clouds
  // Four decks. The lowest is what you actually see from the street — a flat layer has to
  // sit low to reach the horizon at all — and the ones above it are stacked far enough up
  // that the sky reads as deep instead of as a ceiling. Sizes are held inside the far
  // plane, so they shrink as the decks rise.
  const DECKS = [
    { y: 700, size: 5600, repeat: 3.2 },
    { y: 1150, size: 5300, repeat: 3.4 },
    { y: 1750, size: 4900, repeat: 3.6 },
    { y: 2450, size: 4400, repeat: 3.8 }
  ];
  const decks = [];
  for (let i = 0; i < DECKS.length; i++) {
    const d = DECKS[i];
    const mat = new THREE.MeshBasicMaterial({
      map: cloudTexture(i % CLOUD_VARIANTS),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      fog: false,
      opacity: 0.9
    });
    const geo = new THREE.PlaneGeometry(d.size, d.size);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = d.y;
    mesh.renderOrder = -95 + i;
    mesh.frustumCulled = false;
    const tex = mat.map.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(d.repeat, d.repeat);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    scene.add(mesh);
    decks.push({ mesh, mat, rate: (i % 2 ? -1 : 1) * (0.0016 + i * 0.0006), tint: new THREE.Color() });
  }

  return {
    dome,
    uniforms,
    update(s, time) {
      uniforms.uZenith.value.copy(s.zenith);
      uniforms.uHorizon.value.copy(s.horizon);
      uniforms.uGround.value.copy(s.ground);
      uniforms.uSunDir.value.copy(s.sunDir);
      uniforms.uSunColor.value.copy(s.sunColor);
      uniforms.uSunGlow.value.copy(s.sunGlow);
      uniforms.uWarmSky.value.copy(s.warmSky);
      uniforms.uMoonDir.value.copy(s.moonDir);
      uniforms.uMoonColor.value.copy(s.moonColor);
      uniforms.uWarm.value = s.warm;
      uniforms.uStars.value = s.stars;
      uniforms.uMoonUp.value = s.moonUp;
      // Cloud colour has to sit *above* the sky's own value or the bands vanish;
      // scalars past 1 are fine, the OutputPass tone maps them back into range.
      uniforms.uCloudCol.value
        .setRGB(1, 1, 1)
        .lerp(s.warmSky, 0.20 + s.warm * 0.30)
        // Night must not reuse the daytime floor: a floor of 0.26 of white, tone mapped at
        // the night exposure, reads as a grey ceiling over the whole city. What is left is a
        // thin moonlit floor so the bands still have an edge against the stars.
        .multiplyScalar(0.03 + 0.62 * s.daylight + 0.20 * s.warm + 0.09 * s.moonUp * (1 - s.daylight));
      uniforms.uCloudAmt.value = 0.30 + 0.58 * s.daylight + 0.16 * s.warm;
      uniforms.uSunSize.value = THREE.MathUtils.degToRad(0.62 + s.sunDisc * 0.012);
      uniforms.uTime.value = time;

      stars.material.opacity = s.stars * 0.95;
      starGroup.rotation.y = -(s.siderealHours / 24) * TAU;
      starGroup.rotation.z = 0.42;

      // Sun halo sits on the dome, brightest when the sun is low.
      halo.position.copy(s.sunDir).multiplyScalar(SKY_RADIUS * 0.9);
      halo.visible = s.sunDir.y > -0.12;
      const low = 1 - Math.max(0, Math.min(1, s.sunDir.y / 0.4));
      halo.material.color.copy(s.sunGlow).multiplyScalar(0.55 + 0.75 * low);
      halo.scale.setScalar(700 + 520 * low);

      for (const d of decks) {
        // Clouds have to be *lighter* than the sky they sit in front of, or raising them
        // just hides them: at dusk a pink cloud on a pink sky reads as nothing at all.
        // Tinted towards the warm key light, then scaled well past 1 so the tops of the
        // puffs clip towards white while the body keeps the sunset colour.
        const lit = 0.03 + 1.10 * s.daylight;
        d.tint.setRGB(1, 1, 1)
          .lerp(s.warmSky, s.warm * 0.32)
          .multiplyScalar(lit);
        d.mat.color.copy(d.tint);
        d.mat.opacity = 0.26 + 0.52 * s.daylight;
        d.mesh.rotation.z += d.rate * 0.016;
      }
    },
    dispose() {
      dome.geometry.dispose();
      dome.material.dispose();
      starGeo.dispose();
      stars.material.dispose();
      halo.material.dispose();
      for (const d of decks) {
        d.mesh.geometry.dispose();
        d.mat.map?.dispose();
        d.mat.dispose();
      }
    }
  };
}

export { SKY_RADIUS };