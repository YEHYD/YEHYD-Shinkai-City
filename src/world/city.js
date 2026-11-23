// Turns the layout into geometry.
//
// Everything static is merged: four wall meshes (one per facade variant), one roof mesh,
// one lamp-post mesh, one lamp-head mesh, one tree mesh. The whole city costs about a
// dozen draw calls, which is what buys the budget for bloom and a 2 k shadow map.

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  groundMaps, facadeTextures, FACADE_VARIANTS, GROUND_TILE_METERS, styleForBuilding
} from '../core/textures.js';
import { makeRandom } from '../core/random.js';
import { CITY_SIZE, GRID, BAY_W, BAY_H, TILE_BAYS_X, TILE_BAYS_Y, HALF } from './layout.js';

const TILE_W = BAY_W * TILE_BAYS_X;   // metres covered by one facade tile
const TILE_H = BAY_H * TILE_BAYS_Y;

/** Scale a geometry's UVs so windows keep a constant real-world size. */
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Four walls of one building, already positioned in world space. */
function wallPieces(b, out) {
  const { w, h, d, x, z } = b;
  const uW = w / TILE_W, uD = d / TILE_W, vH = h / TILE_H;

  const front = scaleUV(new THREE.PlaneGeometry(w, h), uW, vH);
  front.translate(0, 0, d / 2);
  out.push(front);

  const back = scaleUV(new THREE.PlaneGeometry(w, h), uW, vH);
  back.rotateY(Math.PI);
  back.translate(0, 0, -d / 2);
  out.push(back);

  const right = scaleUV(new THREE.PlaneGeometry(d, h), uD, vH);
  right.rotateY(Math.PI / 2);
  right.translate(w / 2, 0, 0);
  out.push(right);

  const left = scaleUV(new THREE.PlaneGeometry(d, h), uD, vH);
  left.rotateY(-Math.PI / 2);
  left.translate(-w / 2, 0, 0);
  out.push(left);

  for (const g of out.slice(-4)) g.translate(x, h / 2, z);
}

function roofPiece(b) {
  const g = new THREE.PlaneGeometry(b.w, b.d);
  scaleUV(g, 0.06, 0.06);
  g.rotateX(-Math.PI / 2);
  g.translate(b.x, b.h, b.z);
  return g;
}

// ---------------------------------------------------------------- billboard texture
function signTexture(seed, hue) {
  const W = 256, H = 96;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rnd = makeRandom(seed);
  ctx.fillStyle = '#08060f';
  ctx.fillRect(0, 0, W, H);

  const base = `hsl(${Math.round(hue * 360)}, 92%, 62%)`;
  const alt = `hsl(${Math.round((hue * 360 + 42) % 360)}, 95%, 68%)`;

  // A stack of glowing bars — reads as an LED board and blooms beautifully.
  const rows = rnd.int(3, 5);
  for (let r = 0; r < rows; r++) {
    const y = 8 + r * ((H - 16) / rows);
    const rh = (H - 16) / rows - 5;
    let x = 10 + rnd.range(0, 14);
    const end = W - 12 - rnd.range(0, 22);
    while (x < end) {
      const bw = rnd.range(9, 34);
      ctx.fillStyle = rnd.chance(0.72) ? (rnd.chance(0.7) ? base : alt) : 'rgba(120,140,190,.35)';
      ctx.fillRect(x, y, Math.min(bw, end - x), rh);
      x += bw + 5;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- build
export function buildCity(layout, renderer) {
  const group = new THREE.Group();
  group.name = 'city';
  const rnd = makeRandom(8801);

  // ---------------------------------------------------------------- ground
  const groundSet = groundMaps();
  const gRepeat = CITY_SIZE / GROUND_TILE_METERS;
  for (const t of [groundSet.map, groundSet.bumpMap, groundSet.roughnessMap]) {
    t.repeat.set(gRepeat, gRepeat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_SIZE, CITY_SIZE),
    new THREE.MeshStandardMaterial({
      map: groundSet.map,
      bumpMap: groundSet.bumpMap,
      bumpScale: 0.55,
      roughnessMap: groundSet.roughnessMap,
      // Damp asphalt: a little broad reflection of the dusk sky is what keeps the road
      // from reading as flat grey plastic under a sunset. The wet patches in the
      // roughness map are what let the sky actually pool on the tarmac.
      roughness: 1.0,
      metalness: 0.10,
      envMapIntensity: 1.15,
      color: 0xffffff
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // ---------------------------------------------------------------- buildings
  // Grouped by *style* rather than by the random per-building variant: glass towers,
  // ribbed offices and masonry walk-ups each get their own facade set, so a skyline
  // that used to be four interchangeable tiles now reads as three kinds of building.
  const wallsByVariant = Array.from({ length: FACADE_VARIANTS }, () => []);
  const roofs = [];
  for (const b of layout.buildings) {
    wallPieces(b, wallsByVariant[styleForBuilding(b)]);
    roofs.push(roofPiece(b));
  }

  const wallMaterials = [];
  const wallMeshes = [];
  for (let v = 0; v < FACADE_VARIANTS; v++) {
    if (!wallsByVariant[v].length) continue;
    const merged = BufferGeometryUtils.mergeGeometries(wallsByVariant[v], false);
    merged.computeBoundingSphere();
    const { map, emissiveMap, bumpMap, roughnessMap } = facadeTextures(v);
    // Every building shares one tile size, so one repeat of the tile per `TILE_W` metres.
    for (const t of [map, emissiveMap, bumpMap, roughnessMap]) {
      t.repeat.set(1, 1);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      bumpMap,
      bumpScale: 0.35,
      roughnessMap,
      emissive: new THREE.Color(0xffd9a0),
      emissiveIntensity: 0.2,
      roughness: 1.0,
      metalness: 0.14,
      envMapIntensity: 0.85
    });
    wallMaterials.push(mat);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `walls-${v}`;
    group.add(mesh);
    wallMeshes.push(mesh);
    for (const g of wallsByVariant[v]) g.dispose();
  }

  const roofGeo = BufferGeometryUtils.mergeGeometries(roofs, false);
  roofGeo.computeBoundingSphere();
  const roofMesh = new THREE.Mesh(
    roofGeo,
    new THREE.MeshStandardMaterial({ color: 0x3d434d, roughness: 0.92, metalness: 0.05 })
  );
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  roofMesh.name = 'roofs';
  group.add(roofMesh);
  for (const g of roofs) g.dispose();

  // ---------------------------------------------------------------- far skyline
  // Unreachable towers past the grid: they give the horizon depth and are the first thing
  // the fog eats, which is exactly the look we want.
  const farParts = [];
  for (let i = 0; i < 190; i++) {
    const a = rnd.next() * Math.PI * 2;
    const rad = HALF + rnd.range(60, 1050);
    const w = rnd.range(14, 44);
    const d = rnd.range(14, 44);
    const h = rnd.range(24, 210) * (1 - 0.4 * (rad / (HALF + 1050)));
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(rnd.range(0, Math.PI));
    g.translate(Math.cos(a) * rad, h / 2 - 2, Math.sin(a) * rad);
    farParts.push(g);
  }
  const farGeo = BufferGeometryUtils.mergeGeometries(farParts, false);
  farGeo.computeBoundingSphere();
  const farMesh = new THREE.Mesh(
    farGeo,
    new THREE.MeshStandardMaterial({ color: 0x39414f, roughness: 0.95, metalness: 0.06 })
  );
  farMesh.name = 'far-skyline';
  group.add(farMesh);
  for (const g of farParts) g.dispose();

  // ---------------------------------------------------------------- lamps
  const poleParts = [];
  const headParts = [];
  const LAMP_H = 5.2;
  for (const l of layout.lamps) {
    const pole = new THREE.CylinderGeometry(0.085, 0.14, LAMP_H, 5, 1, true);
    pole.translate(l.x, LAMP_H / 2, l.z);
    poleParts.push(pole);

    const arm = new THREE.BoxGeometry(0.85, 0.12, 0.12);
    arm.rotateY(l.yaw);
    arm.translate(l.x + Math.sin(l.yaw) * 0.4, LAMP_H - 0.1, l.z + Math.cos(l.yaw) * 0.4);
    poleParts.push(arm);

    const head = new THREE.SphereGeometry(0.3, 8, 6);
    head.scale(1, 0.62, 0.62);
    head.translate(l.x + Math.sin(l.yaw) * 0.78, LAMP_H - 0.22, l.z + Math.cos(l.yaw) * 0.78);
    headParts.push(head);
  }

  const poleGeo = BufferGeometryUtils.mergeGeometries(poleParts, false);
  const poleMesh = new THREE.Mesh(
    poleGeo,
    new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.55 })
  );
  poleMesh.castShadow = true;
  poleMesh.name = 'lamp-posts';
  group.add(poleMesh);
  for (const g of poleParts) g.dispose();

  const headGeo = BufferGeometryUtils.mergeGeometries(headParts, false);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x1a1d23,
    emissive: new THREE.Color('#ffd9a0'),
    emissiveIntensity: 0,
    roughness: 0.35
  });
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.name = 'lamp-heads';
  group.add(headMesh);
  for (const g of headParts) g.dispose();

  // ---------------------------------------------------------------- signs
  const signGroup = new THREE.Group();
  signGroup.name = 'signs';
  for (let i = 0; i < layout.signs.length; i++) {
    const s = layout.signs[i];
    const tex = signTexture(31 + i * 71, s.hue);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
    mesh.position.set(s.x, s.y, s.z + (s.yaw ? -1 : 1) * 4.2);
    mesh.rotation.y = s.yaw;
    signGroup.add(mesh);
  }
  group.add(signGroup);

  // ---------------------------------------------------------------- plaza trees
  const trunkParts = [];
  const leafParts = [];
  for (const p of layout.plazas) {
    const n = rnd.int(3, 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd.range(-0.3, 0.3);
      const rad = rnd.range(3.5, 9);
      const x = p.x + Math.cos(a) * rad;
      const z = p.z + Math.sin(a) * rad;
      const th = rnd.range(2.4, 3.4);
      const trunk = new THREE.CylinderGeometry(0.14, 0.2, th, 5);
      trunk.translate(x, th / 2, z);
      trunkParts.push(trunk);
      const cr = rnd.range(1.6, 2.5);
      const leaf = new THREE.IcosahedronGeometry(cr, 0);
      leaf.scale(1, 0.86, 1);
      leaf.translate(x, th + cr * 0.55, z);
      leafParts.push(leaf);
    }
  }
  if (trunkParts.length) {
    const tGeo = BufferGeometryUtils.mergeGeometries(trunkParts, false);
    const tMesh = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ color: 0x4a3b30, roughness: 0.95 }));
    tMesh.castShadow = true;
    tMesh.name = 'tree-trunks';
    group.add(tMesh);
    for (const g of trunkParts) g.dispose();

    const lGeo = BufferGeometryUtils.mergeGeometries(leafParts, false);
    const lMesh = new THREE.Mesh(lGeo, new THREE.MeshStandardMaterial({ color: 0x3f7a4e, roughness: 0.9 }));
    lMesh.castShadow = true;
    lMesh.receiveShadow = true;
    lMesh.name = 'tree-leaves';
    group.add(lMesh);
    for (const g of leafParts) g.dispose();
  }

  // ---------------------------------------------------------------- per-frame
  let lastNight = -1;
  return {
    group,
    ground,
    /** Drive the emissive layers from the clock. */
    update(s) {
      // Lamp heads and lit windows follow the sun down, so the golden hour already has
      // street lights burning — keying on night alone kept them dark until after dusk.
      const lit = s.night + s.warm * 0.6;
      if (Math.abs(lit - lastNight) < 0.004) return;
      lastNight = lit;
      headMat.emissiveIntensity = 0.22 + 2.3 * s.night + 1.20 * s.warm;
      for (const mat of wallMaterials) {
        // Lit windows come up as the sky goes down, and never switch off entirely.
        // Kept below the bloom threshold on purpose: window grids are dense, and at 4.4
        // every tower smeared into one bright wash after dark.
        mat.emissiveIntensity = 0.05 + 1.55 * Math.pow(s.night, 1.35) + 0.45 * s.warm;
      }
      signGroup.visible = true;
      for (const m of signGroup.children) {
        m.material.opacity = 0.55 + 0.45 * s.night;
      }
    },
    dispose() {
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m.map?.dispose();
            m.emissiveMap?.dispose();
            m.bumpMap?.dispose();
            m.roughnessMap?.dispose();
            m.dispose();
          }
        }
      });
    }
  };
}