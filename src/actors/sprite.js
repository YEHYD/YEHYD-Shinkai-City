// 2D characters standing in a 3D city.
//
// Each actor is one upright quad that always turns to face the camera, plus a soft contact
// shadow on the pavement. Which of the three baked views (front / side / back) is shown
// depends on where the camera stands relative to the direction the character is facing, so
// walking around someone reads as walking around them.
//
// The quad is unlit on purpose: it is lit by the atmosphere instead, so a character never
// turns into a black silhouette when the sun goes behind a tower.

import * as THREE from 'three';

const loader = new THREE.TextureLoader();

function shadowTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.30)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let SHADOW_TEX = null;

const VIEWS = ['front', 'side', 'back'];
// Angle windows (radians of cos) used to pick a view, with hysteresis so a character
// standing at a boundary does not flicker between two drawings.
const FRONT_COS = 0.42;
const BACK_COS = -0.42;
const HYST = 0.10;

// Where the drawing for one view actually lives: an inlined data: URL in the single-file
// build, the plain webp in the dev tree. The dialogue portrait asks the same question, so
// both paths go through here instead of each one guessing.
export function spriteSrc(id, view, basePath = './assets/characters', inline = null) {
  return (inline && inline[`${id}/${view}`]) || `${basePath}/${id}/${view}.webp`;
}

// `inline` maps "id/view" to an already-resolved URL (a data: URL in the single-file
// build). Falls back to the on-disk webp so the dev tree keeps its plain-file layout.
export async function loadSprites(manifest, basePath = './assets/characters', inline = null) {
  const out = {};
  await Promise.all(Object.entries(manifest).map(async ([id, entry]) => {
    const views = {};
    await Promise.all(VIEWS.map(async v => {
      const info = entry.views[v];
      if (!info) return;
      const src = spriteSrc(id, v, basePath, inline);
      views[v] = await loader.loadAsync(src);
      views[v].colorSpace = THREE.SRGBColorSpace;
      views[v].anisotropy = 8;
      views[v].aspect = info.aspect;
    }));
    out[id] = views;
  }));
  return out;
}

export function createActor(def, views) {
  if (!SHADOW_TEX) SHADOW_TEX = shadowTexture();

  const group = new THREE.Group();
  group.name = def.id;
  group.position.set(def.x, 0, def.z);

  // ---- character quad
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    alphaTest: 0.04,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: true,
    fog: true
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  quad.position.y = def.height / 2;
  quad.scale.set(def.height * (views.front?.aspect ?? 0.5), def.height, 1);
  group.add(quad);

  // ---- contact shadow
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: SHADOW_TEX,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      toneMapped: false,
      fog: true
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 2;
  group.add(shadow);

  const state = {
    id: def.id,
    name: def.name,
    group,
    quad,
    material,
    def,
    facing: def.yaw ?? 0,     // world yaw the character looks along
    view: 'front',
    bobPhase: def.bobPhase ?? Math.random() * Math.PI * 2,
    tint: new THREE.Color(),
    lastAspect: 0
  };

  function setView(v) {
    if (!views[v] || state.view === v) return;
    state.view = v;
    material.map = views[v];
    const aspect = views[v].aspect ?? 0.5;
    state.lastAspect = aspect;
    quad.scale.x = def.height * aspect;
    material.needsUpdate = true;
  }
  setView('front');
  state.lastAspect = views.front?.aspect ?? 0.5;

  return {
    ...state,
    get position() { return group.position; },

    /** Point the character somewhere. Without this the view picker has nothing to work on. */
    setFacing(y) {
      state.facing = y;
    },

    moveTo(x, z) {
      group.position.x = x;
      group.position.z = z;
    },

    /**
     * @param {THREE.Camera} camera
     * @param {object} s atmosphere state
     * @param {number} t seconds
     */
    update(camera, s, t) {
      const p = group.position;

      // --- billboard: yaw the quad toward the camera, keeping it upright
      const dx = camera.position.x - p.x;
      const dz = camera.position.z - p.z;
      const toCamYaw = Math.atan2(dx, dz);
      quad.rotation.y = toCamYaw;

      // --- which drawing we are looking at
      // angle between the character's facing and the direction to the camera
      let diff = toCamYaw - state.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const c = Math.cos(diff);
      let want = state.view;
      if (state.view === 'front') {
        if (c < FRONT_COS - HYST && c > BACK_COS + HYST) want = 'side';
        else if (c <= BACK_COS + HYST) want = 'back';
      } else if (state.view === 'back') {
        if (c > BACK_COS + HYST && c < FRONT_COS - HYST) want = 'side';
        else if (c >= FRONT_COS - HYST) want = 'front';
      } else {
        if (c >= FRONT_COS) want = 'front';
        else if (c <= BACK_COS) want = 'back';
      }
      setView(want);

      // A side view is a profile; mirror it so the character looks the right way round.
      if (state.view === 'side') {
        // sin(diff) > 0 means the camera is to the character's left
        const mirror = Math.sin(diff) < 0 ? -1 : 1;
        quad.scale.x = def.height * state.lastAspect * mirror;
      } else {
        quad.scale.x = def.height * state.lastAspect;
      }

      // --- idle breathing, tiny so it reads as alive rather than bouncy
      const bob = Math.sin(t * 1.55 + state.bobPhase);
      quad.position.y = def.height / 2 + bob * 0.012;
      quad.scale.y = def.height * (1 + bob * 0.004);

      // --- light them with the sky instead of the sun
      // Day: near-white. Dusk: warm. Night: cool and dimmed, so they stay readable.
      state.tint
        .copy(s.hemiSky)
        .lerp(s.lightColor, 0.55 + 0.25 * s.daylight)
        .multiplyScalar(0.62 + 0.55 * s.daylight + 0.20 * s.warm);
      material.color.copy(state.tint);

      // --- contact shadow shrinks and fades as the sun climbs
      const shrink = 0.9 + 0.5 * s.daylight;
      shadow.scale.set(def.height * 0.62 * shrink, def.height * 0.46 * shrink, 1);
      shadow.material.opacity = 0.30 + 0.45 * s.night;
    },

    dispose() {
      quad.geometry.dispose();
      material.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
      for (const v of VIEWS) views[v]?.dispose?.();
    }
  };
}