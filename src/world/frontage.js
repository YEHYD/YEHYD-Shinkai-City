// The street level: shop windows, awnings, name boards, pavement light pools, neon
// signs down the tower faces, vending machines, the utility pole line and the signals.
//
// This is the module that stops the city reading as a massing model. A tower is a wall;
// a shop band, an awning and a pool of warm light on the pavement are a street.
//
// Everything here is merged. One atlas per family means the whole frontage — hundreds of
// windows, boards and machines — costs about a dozen draw calls.

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  shopAtlas, signAtlas, neonAtlas, vendingAtlas, glowTexture,
  SHOP_ATLAS, SIGN_ATLAS, NEON_CELLS, VENDING_CELLS
} from '../core/textures.js';
import { makeRandom } from '../core/random.js';

const SHOP_H = 2.42;        // glazing height
const SHOP_Y = 0.58;        // sill height above the pavement
const AWNING_Y = 3.16;
const BOARD_Y = 3.62;
const UNIT_MIN = 3.8;       // narrowest shop unit
const UNIT_MAX = 5.4;

const AWNING_COLORS = ['#8c3a35', '#2f4a63', '#3c5a43', '#8a6a3a', '#5a4a6e', '#7a4a2e', '#3d4a52'];

// ---------------------------------------------------------------- geometry helpers

/** Map a plane's 0..1 UVs onto one cell of an atlas. */
function toCell(geo, atlas, col, row, inset = 0.004) {
  const u0 = (col + inset) / atlas.cols, u1 = (col + 1 - inset) / atlas.cols;
  const v1 = 1 - (row + inset) / atlas.rows, v0 = 1 - (row + 1 - inset) / atlas.rows;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  }
  uv.needsUpdate = true;
  return geo;
}

/** Bake a flat colour into a geometry so one material can carry many colours. */
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merge(parts, name) {
  if (!parts.length) return null;
  const geo = BufferGeometryUtils.mergeGeometries(parts, false);
  if (!geo) { console.warn('[shinkai] could not merge', name); return null; }
  geo.computeBoundingSphere();
  for (const p of parts) p.dispose();
  return geo;
}

/** Local axes of a face: `yaw` is the rotation of a plane whose normal points outward. */
function faceAxes(yaw) {
  return {
    nx: Math.sin(yaw), nz: Math.cos(yaw),     // outward normal
    lx: Math.cos(yaw), lz: -Math.sin(yaw)     // along the facade
  };
}

// ---------------------------------------------------------------- build
export function buildFrontage(layout, { quality = 'full' } = {}) {
  const rnd = makeRandom(46291);
  const group = new THREE.Group();
  group.name = 'frontage';

  const shopGeo = [];
  const awningGeo = [];
  const boardGeo = [];
  const poolGeo = [];
  const neonGeo = [];
  const vendBody = [];
  const vendFace = [];
  const poleGeo = [];
  const wirePos = [];
  const benchGeo = [];
  const signalGeo = [];
  const lampGeo = [];

  const shade = (yaw, x, y, z, geo) => {
    geo.rotateY(yaw);
    geo.translate(x, y, z);
    return geo;
  };

  // ---------------------------------------------------------------- shop bands
  for (const b of layout.buildings) {
    const faces = b.faces || [];
    for (const face of faces) {
      const { cx, cz, len, yaw } = face;
      const { nx, nz, lx, lz } = faceAxes(yaw);

      const units = Math.max(1, Math.floor(len / rnd.range(UNIT_MIN, UNIT_MAX)));
      const uw = len / units;

      for (let i = 0; i < units; i++) {
        const s = -len / 2 + (i + 0.5) * uw;
        const px = cx + lx * s + nx * 0.035;
        const pz = cz + lz * s + nz * 0.035;

        // --- glazing
        const w = new THREE.PlaneGeometry(uw - 0.42, SHOP_H);
        toCell(w, SHOP_ATLAS, rnd.int(0, SHOP_ATLAS.cols - 1), rnd.int(0, SHOP_ATLAS.rows - 1));
        shopGeo.push(shade(yaw, px, SHOP_Y + SHOP_H / 2, pz, w));

        // --- awning: a slab over the glass, with a short valance at its lip
        const aw = Math.min(uw - 0.18, 4.4);
        const canopy = new THREE.BoxGeometry(aw, 0.08, 1.08);
        canopy.translate(0, 0, 0.54);       // protrude outward from the face
        paint(canopy, rnd.pick(AWNING_COLORS));
        awningGeo.push(shade(yaw, px, AWNING_Y, pz, canopy));

        const valance = new THREE.PlaneGeometry(aw, 0.26);
        paint(valance, rnd.pick(AWNING_COLORS));
        valance.translate(0, -0.17, 1.06);
        awningGeo.push(shade(yaw, px, AWNING_Y, pz, valance));

        // --- name board above it
        const board = new THREE.PlaneGeometry(Math.min(uw - 0.7, 3.6), 0.62);
        toCell(board, SIGN_ATLAS, rnd.int(0, SIGN_ATLAS.cols - 1), rnd.int(0, SIGN_ATLAS.rows - 1));
        boardGeo.push(shade(yaw, cx + lx * s + nx * 0.09, BOARD_Y + 0.31, cz + lz * s + nz * 0.09, board));

        // --- the pool of warm light the shop throws on the pavement
        const pool = new THREE.PlaneGeometry(aw * 0.92, 3.1);
        pool.rotateX(-Math.PI / 2);
        pool.translate(0, 0.02, 1.5);
        poolGeo.push(shade(yaw, px, 0, pz, pool));
      }

      // --- a vertical neon board on some of the taller faces
      if (b.h > 14 && rnd.chance(0.34) && quality === 'full') {
        const s = rnd.range(-len / 2 + 1.2, len / 2 - 1.2);
        const cell = rnd.int(0, NEON_CELLS - 1);
        const board = new THREE.PlaneGeometry(0.92, 3.3);
        // read along the street, so the board faces *along* the facade, not across it
        const cellU = [cell / NEON_CELLS, (cell + 1) / NEON_CELLS];
        const uv = board.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, cellU[0] + (cellU[1] - cellU[0]) * uv.getX(i), uv.getY(i));
        }
        const y = rnd.range(5.0, Math.min(11, b.h - 2));
        const bx = cx + lx * s + nx * 0.62;
        const bz = cz + lz * s + nz * 0.62;
        board.rotateY(yaw + Math.PI / 2);
        board.translate(bx, y, bz);
        neonGeo.push(board);
      }
    }
  }

  // ---------------------------------------------------------------- vending machines
  const props = layout.props || { vending: [], poles: [], wires: [], signals: [], benches: [], trees: [] };
  for (const v of props.vending) {
    const body = new THREE.BoxGeometry(0.92, 1.86, 0.72);
    paint(body, rnd.pick(['#c8ccd2', '#2c3440', '#8f2f2c', '#2a4d78']));
    vendBody.push(shade(v.yaw, v.x, 0.93, v.z, body));

    const face = new THREE.PlaneGeometry(0.84, 1.7);
    const cell = rnd.int(0, VENDING_CELLS - 1);
    const col = cell % 4, row = Math.floor(cell / 4);
    toCell(face, { cols: 4, rows: 2 }, col, row);
    face.translate(0, 0, 0.37);
    vendFace.push(shade(v.yaw, v.x, 0.95, v.z, face));
  }

  // ---------------------------------------------------------------- poles + wires
  const POLE_H = 7.8;
  for (const p of props.poles) {
    const pole = new THREE.CylinderGeometry(0.10, 0.15, POLE_H, 6);
    pole.translate(p.x, POLE_H / 2, p.z);
    poleGeo.push(pole);
    // a crossarm high up, which is what makes the silhouette read as a utility line
    const arm = new THREE.BoxGeometry(1.5, 0.09, 0.09);
    arm.translate(p.x, POLE_H - 0.7, p.z);
    poleGeo.push(arm);
  }
  const WIRE_Y = POLE_H - 0.55, SAG = 1.05, SEGMENTS = 6;
  for (const w of props.wires) {
    let px = w.x1, py = WIRE_Y, pz = w.z1;
    for (let i = 1; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const x = w.x1 + (w.x2 - w.x1) * t;
      const z = w.z1 + (w.z2 - w.z1) * t;
      const y = WIRE_Y - Math.sin(Math.PI * t) * SAG;
      wirePos.push(px, py, pz, x, y, z);
      px = x; py = y; pz = z;
    }
  }

  // ---------------------------------------------------------------- signals
  for (const g of props.signals) {
    const post = new THREE.CylinderGeometry(0.075, 0.10, 4.4, 6);
    post.translate(g.x, 2.2, g.z);
    signalGeo.push(post);

    const { nx, nz } = faceAxes(g.yaw);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 2.6);
    arm.rotateY(g.yaw);
    arm.translate(g.x + nx * 1.3, 4.3, g.z + nz * 1.3);
    signalGeo.push(arm);

    const head = new THREE.BoxGeometry(0.30, 0.86, 0.26);
    head.rotateY(g.yaw);
    head.translate(g.x + nx * 2.5, 4.05, g.z + nz * 2.5);
    signalGeo.push(head);

    // three lenses on the face of the head; only the green one is lit, as a street at
    // walking pace only ever shows you one state
    for (let i = 0; i < 3; i++) {
      const lens = new THREE.CircleGeometry(0.075, 8);
      lens.rotateY(g.yaw);
      lens.translate(g.x + nx * 2.64, 4.28 - i * 0.23, g.z + nz * 2.64);
      paint(lens, i === 2 ? '#3ef08a' : (i === 1 ? '#3a3026' : '#3a2226'));
      lampGeo.push(lens);
    }
  }

  // ---------------------------------------------------------------- benches
  for (const bch of props.benches) {
    const seat = new THREE.BoxGeometry(1.7, 0.09, 0.52);
    seat.translate(0, 0.44, 0);
    paint(seat, '#6b5642');
    benchGeo.push(shade(bch.yaw, bch.x, 0, bch.z, seat));

    const back = new THREE.BoxGeometry(1.7, 0.42, 0.08);
    back.translate(0, 0.66, -0.22);
    paint(back, '#6b5642');
    benchGeo.push(shade(bch.yaw, bch.x, 0, bch.z, back));

    for (const sx of [-0.72, 0.72]) {
      const leg = new THREE.BoxGeometry(0.09, 0.42, 0.46);
      leg.translate(sx, 0.21, 0);
      paint(leg, '#3a3f47');
      benchGeo.push(shade(bch.yaw, bch.x, 0, bch.z, leg));
    }
  }

  // ---------------------------------------------------------------- greenery
  // Street trees stand on the kerb line, bushes fill the plaza edges, and the towers
  // carry planters out on their balconies. Two instanced meshes carry all of it: a trunk
  // and a set of leaf lobes, so a few hundred plants cost two draw calls.
  const streetTrees = (props.trees || []).filter(t => t.kind === 'street');
  const plazaBushes = (props.trees || []).filter(t => t.kind === 'bush');

  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.21, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  const leafGeo = merge([
    new THREE.IcosahedronGeometry(1.35, 0).translate(0, 2.95, 0),
    new THREE.IcosahedronGeometry(1.02, 0).translate(0.78, 2.42, 0.34),
    new THREE.IcosahedronGeometry(0.92, 0).translate(-0.68, 2.52, -0.36),
    new THREE.IcosahedronGeometry(0.86, 0).translate(0.12, 2.22, -0.64)
  ], 'leaf-lobes');
  const bushGeo = merge([
    new THREE.IcosahedronGeometry(0.62, 0).translate(0, 0.5, 0),
    new THREE.IcosahedronGeometry(0.46, 0).translate(0.52, 0.36, 0.18),
    new THREE.IcosahedronGeometry(0.42, 0).translate(-0.44, 0.34, -0.2)
  ], 'bush-lobes');

  // --- balcony planters: one row per occupied floor, on the street faces of tall blocks
  // Skipped entirely on the lite profile: they are the single biggest instance count in the
  // greenery pass (632 boxes + 632 leaf clumps) and read as small green smudges at phone
  // distance, which is exactly where lite lives.
  const balconySpots = [];
  for (const b of (quality === 'lite' ? [] : layout.buildings)) {
    if (b.h < 16) continue;
    for (const face of (b.faces || [])) {
      const { cx, cz, len, yaw } = face;
      const { nx, nz, lx, lz } = faceAxes(yaw);
      const floors = Math.min(3, Math.floor((Math.min(b.h, 26) - 5) / 3.2));
      for (let f = 0; f < floors; f++) {
        if (!rnd.chance(0.55)) continue;
        if (len < 4) continue;
        const y = 4.8 + f * 3.2;
        const s = rnd.range(-len / 2 + 1.0, len / 2 - 1.0);
        balconySpots.push({
          x: cx + lx * s + nx * 0.5,
          y,
          z: cz + lz * s + nz * 0.5,
          yaw,
          scale: rnd.range(0.34, 0.52)
        });
      }
    }
  }

  const LEAF_TINT = ['#3d6b45', '#4a7a4e', '#33573c', '#588a5c', '#2f4f36'];
  const UP = new THREE.Vector3(0, 1, 0);
  const mtx = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const vec = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3b2d, roughness: 0.92, metalness: 0.02 });
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.02, flatShading: true });
  const planterMat = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.88, metalness: 0.04 });

  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, streetTrees.length));
  trunkMesh.name = 'tree-trunks';
  trunkMesh.castShadow = true;

  const leafTotal = streetTrees.length + plazaBushes.length + balconySpots.length;
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, Math.max(1, leafTotal));
  leafMesh.name = 'tree-leaves';
  leafMesh.castShadow = true;

  const bushMesh = new THREE.InstancedMesh(bushGeo, leafMat, Math.max(1, plazaBushes.length));
  bushMesh.name = 'plaza-bushes';
  bushMesh.castShadow = true;

  const planterMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.02, 0.2, 0.34),
    planterMat,
    Math.max(1, balconySpots.length)
  );
  planterMesh.name = 'balcony-planters';
  planterMesh.castShadow = true;

  let li = 0;
  streetTrees.forEach((t, i) => {
    const s = t.scale ?? 1;
    quat.setFromAxisAngle(UP, (t.seed ?? 0.5) * Math.PI * 2);
    mtx.compose(vec.set(t.x, 0, t.z), quat, scl.set(s, s, s));
    trunkMesh.setMatrixAt(i, mtx);
    leafMesh.setMatrixAt(li, mtx);
    leafMesh.setColorAt(li, tint.set(LEAF_TINT[i % LEAF_TINT.length]));
    li++;
  });
  trunkMesh.count = streetTrees.length;

  plazaBushes.forEach((b, i) => {
    const s = (b.scale ?? 1) * 0.95;
    quat.setFromAxisAngle(UP, (b.seed ?? 0.4) * Math.PI * 2);
    mtx.compose(vec.set(b.x, 0, b.z), quat, scl.set(s, s, s));
    bushMesh.setMatrixAt(i, mtx);
    bushMesh.setColorAt(i, tint.set(LEAF_TINT[(i + 2) % LEAF_TINT.length]));
  });
  bushMesh.count = plazaBushes.length;

  balconySpots.forEach((p, i) => {
    const s = p.scale;
    quat.setFromAxisAngle(UP, p.yaw);
    mtx.compose(vec.set(p.x, p.y, p.z), quat, scl.set(s, s, s));
    leafMesh.setMatrixAt(li, mtx);
    leafMesh.setColorAt(li, tint.set(LEAF_TINT[(i + 1) % LEAF_TINT.length]));
    li++;
    mtx.compose(vec.set(p.x, p.y - 0.18, p.z), quat, scl.set(1, 1, 1));
    planterMesh.setMatrixAt(i, mtx);
  });
  leafMesh.count = li;
  planterMesh.count = balconySpots.length;

  for (const m of [trunkMesh, leafMesh, bushMesh, planterMesh]) {
    m.instanceMatrix.needsUpdate = true;
    m.frustumCulled = false;
    group.add(m);
  }
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  if (bushMesh.instanceColor) bushMesh.instanceColor.needsUpdate = true;

  // ---------------------------------------------------------------- materials
  const shopTex = shopAtlas();
  const shopMat = new THREE.MeshStandardMaterial({
    map: shopTex,
    emissiveMap: shopTex,
    emissive: new THREE.Color('#ffd9a4'),
    emissiveIntensity: 0.06,
    roughness: 0.46,
    metalness: 0.10,
    envMapIntensity: 0.5
  });

  const awningMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide
  });

  const signTex = signAtlas();
  const boardMat = new THREE.MeshStandardMaterial({
    map: signTex,
    emissiveMap: signTex,
    emissive: new THREE.Color('#fff0d2'),
    emissiveIntensity: 0.10,
    roughness: 0.55,
    metalness: 0.05
  });

  const poolMat = new THREE.MeshBasicMaterial({
    map: glowTexture('rgba(255,220,168,0.85)', 'rgba(255,180,110,0)'),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: false
  });

  const neonMat = new THREE.MeshBasicMaterial({
    map: neonAtlas(),
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: true
  });

  const vendBodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
  const vendTex = vendingAtlas();
  const vendFaceMat = new THREE.MeshStandardMaterial({
    map: vendTex,
    emissiveMap: vendTex,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.12,
    roughness: 0.32,
    metalness: 0.05
  });

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a5148, roughness: 0.86, metalness: 0.12 });
  const benchMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04 });
  const signalMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.55, metalness: 0.6 });
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

  const add = (geo, mat, name, opts = {}) => {
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = opts.cast ?? false;
    mesh.receiveShadow = opts.receive ?? false;
    if (opts.order !== undefined) mesh.renderOrder = opts.order;
    group.add(mesh);
    return mesh;
  };

  add(merge(shopGeo, 'shops'), shopMat, 'shop-windows', { receive: true });
  add(merge(awningGeo, 'awnings'), awningMat, 'awnings', { cast: true, receive: true });
  add(merge(boardGeo, 'boards'), boardMat, 'shop-boards');
  add(merge(poolGeo, 'pools'), poolMat, 'shop-pools', { order: 1 });
  add(merge(neonGeo, 'neon'), neonMat, 'neon-signs');
  add(merge(vendBody, 'vending'), vendBodyMat, 'vending-bodies', { cast: true, receive: true });
  add(merge(vendFace, 'vending-faces'), vendFaceMat, 'vending-faces');
  add(merge(poleGeo, 'poles'), poleMat, 'utility-poles', { cast: true });
  add(merge(benchGeo, 'benches'), benchMat, 'benches', { cast: true, receive: true });
  add(merge(signalGeo, 'signals'), signalMat, 'signal-poles', { cast: true });
  add(merge(lampGeo, 'signal-lamps'), lampMat, 'signal-lamps');

  // wires are lines, not triangles: two vertices per segment, one draw call for the city
  if (wirePos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wirePos), 3));
    const wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: 0x171b22, transparent: true, opacity: 0.55, fog: true
    }));
    wires.name = 'wires';
    group.add(wires);
  }

  let last = -1;
  return {
    group,
    /** Drive the frontage from the clock. */
    update(s) {
      // Shops come alive during the golden hour, not only after dark, so the driver is
      // night plus a warm term — keying on night alone left the whole street unlit at
      // 18:00 when night is still ~0.1.
      const lit = s.night + s.warm * 0.62;
      if (Math.abs(lit - last) < 0.004) return;
      last = lit;
      const n = s.night;
      const w = s.warm;
      // Shop interiors are the main source of street warmth; they stay on a little at
      // dusk and read as "open" without blowing out via bloom.
      shopMat.emissiveIntensity = 0.05 + 0.62 * Math.pow(n, 1.2) + 0.42 * w;
      boardMat.emissiveIntensity = 0.07 + 0.62 * n + 0.35 * w;
      vendFaceMat.emissiveIntensity = 0.09 + 0.44 * n + 0.30 * w;
      poolMat.opacity = 0.24 * Math.pow(n, 1.3) + 0.16 * w;
      neonMat.color.setScalar(0.34 + 0.44 * n + 0.30 * w);
    },
    dispose() {
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) m.dispose();
      });
    }
  };
}