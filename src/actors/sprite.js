// 2D characters standing in a 3D city.
//
// Each actor is one upright quad that always turns to face the camera, plus a soft contact
// shadow on the pavement. Which of the three baked views (front / side / back) is shown
// depends on where the camera stands relative to the direction the character is facing, so
// walking around someone reads as walking around them.
//
// The quad is unlit on purpose: it is lit by the atmosphere instead, so a character never
// turns into a black silhouette when the sun goes behind a tower.
//
// Actors that can be talked to also carry a small exclamation mark over their head. It is
// drawn procedurally from the vector path in 素材/感叹号-橙.svg rather than loaded as a file:
// the shipped build is one HTML file opened straight off disk, so a relative path with CJK
// in it is exactly the kind of thing that breaks there, and a Path2D costs one string.

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

// ---------------------------------------------------------------- talk marker
// The glyph from 素材/感叹号-橙.svg, in its 1024-unit design space. Kept as the raw path data
// so the drawing pipeline can tweak the plate (halo, colour, margins) without touching the
// source art; the geometry itself is the artist's.
const BANG_PATH = 'M468.114286 621.714286c7.314286 21.942857 21.942857 36.571429 43.885714 36.571428s36.571429-14.628571 43.885714-36.571428L585.142857 219.428571c0-43.885714-36.571429-73.142857-73.142857-73.142857-43.885714 0-73.142857 36.571429-73.142857 80.457143l29.257143 394.971429zM512 731.428571c-43.885714 0-73.142857 29.257143-73.142857 73.142858s29.257143 73.142857 73.142857 73.142857 73.142857-29.257143 73.142857-73.142857-29.257143-73.142857-73.142857-73.142858z';
const BANG_BOX = { cx: 511.5, cy: 511.5, height: 731 };   // glyph bounds inside the 1024 viewBox
const BANG_FILL = '#e69645';

function bangTexture() {
  // The plate is cropped to the glyph instead of being a square with two thirds of its
  // pixels empty: at 30 m a square plate spends most of its width on nothing, and the mark
  // ends up as thin air with a hairline in it.
  const W = 160;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const path = new Path2D(BANG_PATH);

  const k = (H * 0.86) / BANG_BOX.height;
  ctx.setTransform(k, 0, 0, k, W / 2 - BANG_BOX.cx * k, H / 2 - BANG_BOX.cy * k);

  // A dark rim underneath keeps the mark readable against the bright dusk sky and against a
  // white facade alike — the orange alone disappears on both.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(46, 26, 12, 0.72)';
  ctx.lineWidth = 44;
  ctx.stroke(path);
  ctx.fillStyle = BANG_FILL;
  ctx.fill(path);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
let BANG_TEX = null;
const BANG_ASPECT = 160 / 512;   // the plate's width per unit of height

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

export function createActor(def, views, opts = {}) {
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

  // ---- "you can talk to this one" mark
  // A mark over every head would turn the street into a quest hub, so it fades out with
  // distance: full while you could plausibly walk over, gone by the time it would be a
  // pixel. The bob is the character's own phase so the marks on a row of people do not
  // pulse in lockstep.
  let marker = null;
  if (opts.marker) {
    if (!BANG_TEX) BANG_TEX = bangTexture();
    const size = 0.50;                       // world height of the mark, before the
    marker = new THREE.Mesh(                 // distance compensation below
      new THREE.PlaneGeometry(BANG_ASPECT, 1),
      new THREE.MeshBasicMaterial({
        map: BANG_TEX,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        fog: false
      })
    );
    marker.position.y = def.height + 0.56;
    marker.scale.setScalar(size);
    marker.renderOrder = 4;
    group.add(marker);
  }

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
    lastAspect: 0,
    markerOn: !!marker
  };

  function setView(v) {
    if (!views[v] || state.view === v) return;
    state.view = v;
    material.map = views[v];
    const aspect = views[v].aspect ?? 0.5;
    state.lastAspect = aspect;
    quad.scale.x = def.height * aspect;
    // No material.needsUpdate here on purpose: the shader always carries a map and only
    // the texture changes, so revalidating the program on every front/side/back flip would
    // cost a hitch for nothing.
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

    /** Show or hide this actor's talk mark (used while a conversation is open). */
    setMarker(on) {
      state.markerOn = on !== false;
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

      // --- the talk mark: same billboard as the body, its own slow bob, and a cut-out past
      // the distance where you would still bother walking over
      if (marker) {
        marker.rotation.y = toCamYaw;
        const near = Math.hypot(dx, dz);
        const fade = near > 90 ? Math.max(0, 1 - (near - 90) / 45) : 1;
        marker.visible = state.markerOn && fade > 0.02;
        marker.material.opacity = fade;
        // The mark is an overlay, not part of the world: it keeps roughly the same size on
        // screen whether the character is two metres away or across the street, and only
        // stops growing when it is close enough to be larger than the head it sits over.
        const size = Math.min(2.4, Math.max(0.62, near * 0.050));
        const beat = t * 2.15 + state.bobPhase;
        marker.position.y = def.height + 0.30 + size * 0.55 + Math.sin(beat) * 0.035;
        marker.scale.set(size, size * (1 + Math.sin(beat) * 0.045), 1);
      }
    },

    dispose() {
      quad.geometry.dispose();
      material.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
      if (marker) {
        marker.geometry.dispose();
        marker.material.dispose();
      }
      for (const v of VIEWS) views[v]?.dispose?.();
    }
  };
}