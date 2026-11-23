// The crowd: pedestrians walking the sidewalks.
//
// They are the same 2D artwork as the named characters, drawn through InstancedMesh so
// sixty of them cost a handful of draw calls instead of sixty. Each walker owns a lane —
// a road and an offset onto its pavement — and simply walks it, reversing at the city
// edge. No path-finding, no turning at junctions: a lane is all a passer-by needs, and
// it can never walk through a wall.

import * as THREE from 'three';
import { makeRandom, TAU } from '../core/random.js';
import { CELL, HALF, WALK_IN, WALK_OUT } from '../world/layout.js';

const VIEWS = ['front', 'side', 'back'];
const FRONT_COS = 0.42;
const BACK_COS = -0.42;

const UP = new THREE.Vector3(0, 1, 0);

function shadowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.50)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {Record<string, Record<'front'|'side'|'back', THREE.Texture>>} sprites
 * @param {{quality?: string}} opts
 */
export function createCrowd(sprites, opts = {}) {
  const rnd = makeRandom(70713);
  const count = opts.quality === 'lite' ? 210 : 520;

  const arts = Object.keys(sprites).filter(id => id !== 'player' && sprites[id]?.front);
  const group = new THREE.Group();
  group.name = 'crowd';
  if (!arts.length) return { group, update() {}, dispose() {} };

  const QUAD = new THREE.PlaneGeometry(1, 1);
  const MAX = count + 4;

  // --- one InstancedMesh per (artwork, view): the view is chosen per frame, so the
  // same walker can move between three meshes as the camera swings around them.
  const buckets = [];
  const byKey = new Map();
  for (const art of arts) {
    for (const view of VIEWS) {
      const tex = sprites[art][view];
      if (!tex) continue;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.04,
        depthWrite: true,
        side: THREE.DoubleSide,
        toneMapped: true,
        fog: true
      });
      const mesh = new THREE.InstancedMesh(QUAD, mat, MAX);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = `crowd-${art}-${view}`;
      group.add(mesh);
      const bucket = { mesh, mat, n: 0, aspect: tex.aspect ?? 0.5 };
      buckets.push(bucket);
      byKey.set(`${art}:${view}`, bucket);
    }
  }

  // --- contact shadows, one instanced quad for the whole crowd
  const shadowMesh = new THREE.InstancedMesh(
    QUAD,
    new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      toneMapped: false,
      fog: true
    }),
    MAX
  );
  shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadowMesh.count = 0;
  shadowMesh.frustumCulled = false;
  shadowMesh.renderOrder = 2;
  shadowMesh.name = 'crowd-shadows';
  group.add(shadowMesh);

  // ---------------------------------------------------------------- the walkers
  const walkers = [];
  const lanes = [];
  // every road line, both sides, two sub-lanes a little apart
  for (let k = 0; k <= Math.round((HALF * 2) / CELL); k++) {
    const line = -HALF + CELL * k;
    for (const side of [-1, 1]) {
      lanes.push({ axis: 'z', road: line, off: side * WALK_IN });
      lanes.push({ axis: 'z', road: line, off: side * WALK_OUT });
      lanes.push({ axis: 'x', road: line, off: side * WALK_IN });
      lanes.push({ axis: 'x', road: line, off: side * WALK_OUT });
    }
  }

  for (let i = 0; i < count; i++) {
    // Round-robin the lanes and stratify t inside each one. Picking both at random
    // leaves whole blocks deserted while three people share one corner — the city
    // reads as empty even with a few hundred walkers in it.
    const lane = lanes[i % lanes.length];
    const perLane = Math.max(1, Math.ceil(count / lanes.length));
    const slot = Math.floor(i / lanes.length);
    const art = arts[rnd.int(0, arts.length - 1)];
    // a fifth of the crowd stands still, looking into shop windows
    const idle = rnd.chance(0.18);
    walkers.push({
      art,
      lane,
      t: -HALF + 8 + ((slot + rnd.next()) / perLane) * (HALF * 2 - 16),
      dir: rnd.chance(0.5) ? 1 : -1,
      speed: idle ? 0 : rnd.range(0.85, 1.65),
      height: rnd.range(1.52, 1.78),
      bobPhase: rnd.range(0, TAU),
      idle,
      facing: rnd.range(0, TAU),
      view: 'front',
      x: 0, z: 0
    });
  }

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();

  function place(w) {
    if (w.lane.axis === 'z') {
      w.x = w.lane.road + w.lane.off;
      w.z = w.t;
    } else {
      w.x = w.t;
      w.z = w.lane.road + w.lane.off;
    }
  }

  return {
    group,
    walkers,

    update(camera, s, dt, time) {
      const cx = camera.position.x, cz = camera.position.z;

      for (const b of buckets) b.n = 0;
      let shadowCount = 0;

      for (let i = 0; i < walkers.length; i++) {
        const w = walkers[i];

        if (!w.idle) {
          w.t += w.dir * w.speed * dt;
          // turn around at the edge of the city rather than blinking out of existence
          if (w.t > HALF - 6) { w.t = HALF - 6; w.dir = -1; }
          else if (w.t < -HALF + 6) { w.t = -HALF + 6; w.dir = 1; }
        }
        place(w);

        // --- facing: along the lane, or wherever an idle one happens to be looking
        if (!w.idle) {
          w.facing = w.lane.axis === 'z'
            ? (w.dir > 0 ? 0 : Math.PI)
            : (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        }

        // --- billboard yaw and view pick (the same rule the named characters use)
        const toCamYaw = Math.atan2(cx - w.x, cz - w.z);
        let diff = toCamYaw - w.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const c = Math.cos(diff);
        if (c >= FRONT_COS) w.view = 'front';
        else if (c <= BACK_COS) w.view = 'back';
        else w.view = 'side';

        const bucket = byKey.get(`${w.art}:${w.view}`);
        if (!bucket || bucket.n >= MAX) continue;

        const bob = w.idle ? Math.sin(time * 1.3 + w.bobPhase) * 0.008
          : Math.abs(Math.sin(time * (2.2 + w.speed * 1.4) + w.bobPhase)) * 0.045;
        const mirror = w.view === 'side' && Math.sin(diff) < 0 ? -1 : 1;
        const width = w.height * bucket.aspect;

        pos.set(w.x, w.height / 2 + bob, w.z);
        quat.setFromAxisAngle(UP, toCamYaw);
        scl.set(width * mirror, w.height, 1);
        m4.compose(pos, quat, scl);
        bucket.mesh.setMatrixAt(bucket.n++, m4);

        // --- contact shadow
        const sh = w.height * 0.55;
        pos.set(w.x, 0.015, w.z);
        quat.setFromAxisAngle(UP, toCamYaw);
        scl.set(sh, sh * 0.62, 1);
        m4.compose(pos, quat, scl);
        shadowMesh.setMatrixAt(shadowCount++, m4);
      }

      for (const b of buckets) {
        b.mesh.count = b.n;
        b.mesh.instanceMatrix.needsUpdate = true;
        // lit by the sky, exactly like the named characters
        tint.copy(s.hemiSky)
          .lerp(s.lightColor, 0.55 + 0.25 * s.daylight)
          .multiplyScalar(0.60 + 0.52 * s.daylight + 0.18 * s.warm);
        b.mat.color.copy(tint);
      }
      shadowMesh.count = shadowCount;
      shadowMesh.instanceMatrix.needsUpdate = true;
      shadowMesh.material.opacity = 0.22 + 0.34 * s.night;
    },

    dispose() {
      QUAD.dispose();
      // the maps are shared with the named characters — leave them to loadSprites
      for (const b of buckets) { b.mesh.dispose(); b.mat.dispose(); }
      shadowMesh.dispose();
      shadowMesh.material.dispose();
    }
  };
}