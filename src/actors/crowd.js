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

// Beyond this the walker is a couple of pixels tall and sitting in fog — skip its
// billboard matrix and its furniture push entirely. The named characters and the
// traffic keep their own, much larger, ranges.
const CULL_FAR = 118;
const PUSH_FAR = 46;   // only settle collisions this close to the camera

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

  // Every artwork costs three InstancedMeshes (one per view), so the crowd only borrows a
  // handful of the cast's drawings. Fifteen characters would mean 45 extra draw calls for
  // pedestrians nobody looks at closely.
  const all = Object.keys(sprites).filter(id => id !== 'player' && sprites[id]?.front);
  const arts = all.slice(0, opts.maxArts ?? 9);
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

  // ---------------------------------------------------------------- street furniture
  // A lane is only a line, so a vending machine, a pole or a tree that happens to stand on
  // that line gets walked straight through — you see half a passer-by sticking out of a
  // machine as the camera comes round the corner. Collect the furniture once into a coarse
  // grid and shove each walker out of whatever it is standing in; the push is radial, so
  // people slide round a tree instead of stopping dead against it.
  const OBSTACLE_R = { vending: 0.62, poles: 0.26, signals: 0.30, benches: 0.72 };
  const GRID = 6;
  const furniture = new Map();
  const addFurniture = (x, z, r) => {
    const key = `${Math.floor(x / GRID)}|${Math.floor(z / GRID)}`;
    let list = furniture.get(key);
    if (!list) { list = []; furniture.set(key, list); }
    list.push({ x, z, r });
  };
  {
    const p = opts.props || {};
    for (const v of p.vending || []) addFurniture(v.x, v.z, OBSTACLE_R.vending);
    for (const v of p.poles || []) addFurniture(v.x, v.z, OBSTACLE_R.poles);
    for (const v of p.signals || []) addFurniture(v.x, v.z, OBSTACLE_R.signals);
    for (const v of p.benches || []) addFurniture(v.x, v.z, OBSTACLE_R.benches);
    for (const v of p.trees || []) addFurniture(v.x, v.z, v.kind === 'bush' ? 0.50 : 0.52);
    // the named characters stand still for minutes at a time — a passer-by walking through
    // one of them is the most obvious glitch of the lot
    for (const n of opts.npcs || []) addFurniture(n.x, n.z, 0.58);
  }
  const BODY_R = 0.34;   // half a shoulder
  const KERB_LIMIT = 6.55; // never let a push shove someone into the traffic

  function clearOfFurniture(w) {
    let px = w.x, pz = w.z;
    const gx = Math.floor(px / GRID), gz = Math.floor(pz / GRID);
    for (let pass = 0; pass < 2; pass++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = furniture.get(`${gx + dx}|${gz + dz}`);
          if (!list) continue;
          for (const o of list) {
            const ox = px - o.x, oz = pz - o.z;
            const need = o.r + BODY_R;
            const d2 = ox * ox + oz * oz;
            if (d2 >= need * need) continue;
            const d = Math.sqrt(d2) || 0.0001;
            const push = (need - d) / d;
            px += ox * push;
            pz += oz * push;
          }
        }
      }
    }
    // clamp the lateral offset so nobody ends up standing in a lane of traffic
    const lat = w.lane.axis === 'z' ? px - w.lane.road : pz - w.lane.road;
    if (Math.abs(lat) < KERB_LIMIT) {
      const sign = lat >= 0 ? 1 : -1;
      if (w.lane.axis === 'z') px = w.lane.road + sign * KERB_LIMIT;
      else pz = w.lane.road + sign * KERB_LIMIT;
    }
    w.x = px;
    w.z = pz;
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

        const wdx = w.x - cx, wdz = w.z - cz;
        const d2 = wdx * wdx + wdz * wdz;
        if (d2 > CULL_FAR * CULL_FAR) continue;      // too far to see: no matrix, no push
        if (d2 < PUSH_FAR * PUSH_FAR) clearOfFurniture(w);

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