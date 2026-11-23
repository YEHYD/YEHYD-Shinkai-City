// The plan of the city: where every tower stands, how tall it is, where the lamps go and
// which blocks stay open as plazas.
//
// Deliberately data-only. layout.js decides, city.js draws. That split is what lets the
// collision list, the NPC spots and the geometry all come from one source of truth.

import { makeRandom } from '../core/random.js';

export const CELL = 48;        // metres between road centre lines
export const GRID = 10;        // cells per side
export const CITY_SIZE = CELL * GRID;
export const HALF = CITY_SIZE / 2;
export const ROAD_HALF = 6;    // road half width
export const WALK = 3;         // sidewalk width
export const LOT = CELL - (ROAD_HALF + WALK) * 2;   // 30 m of buildable block
const LOT_MARGIN = 2.5;

// Window bays in the facade tile, used to keep window size constant across towers.
export const BAY_W = 3.0;
export const BAY_H = 3.6;
export const TILE_BAYS_X = 6;
export const TILE_BAYS_Y = 6;

/** Where the player starts: the crossing at the centre of the grid. */
export const SPAWN = { x: 0, z: 0, yaw: Math.PI };

/** Pedestrian lanes, measured out from a road's centre line. They hug the kerb so the
 *  crowd walks past the furniture parked against the shopfronts instead of through it. */
export const WALK_IN = ROAD_HALF + 1.05;
export const WALK_OUT = ROAD_HALF + 1.45;

// A facade only carries shops where it is close enough to a carriageway to be read as
// the street wall. Faces deep inside a block stay blank — that is a courtyard, not a shop.
const FACE_REACH = 13;

function nearestRoad(v) {
  const k = Math.max(0, Math.min(GRID, Math.round((v + HALF) / CELL)));
  return Math.abs(v - (k * CELL - HALF));
}

/**
 * The four sides of a building, flagged with the outward yaw of a plane that would sit
 * on that side. yaw is the rotation of a PlaneGeometry whose normal points outward.
 */
function streetFaces(x, z, w, d) {
  const out = [];
  if (nearestRoad(x + w / 2) < FACE_REACH) out.push({ cx: x + w / 2, cz: z, len: d, yaw: Math.PI / 2 });
  if (nearestRoad(x - w / 2) < FACE_REACH) out.push({ cx: x - w / 2, cz: z, len: d, yaw: -Math.PI / 2 });
  if (nearestRoad(z + d / 2) < FACE_REACH) out.push({ cx: x, cz: z + d / 2, len: w, yaw: 0 });
  if (nearestRoad(z - d / 2) < FACE_REACH) out.push({ cx: x, cz: z - d / 2, len: w, yaw: Math.PI });
  return out;
}

export function generateLayout(seed = 20261123, opts = {}) {
  const rnd = makeRandom(seed);
  const buildings = [];
  const plazas = [];
  const lamps = [];
  const signs = [];

  const blockCenters = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      blockCenters.push({
        x: -HALF + CELL * i + CELL / 2,
        z: -HALF + CELL * j + CELL / 2
      });
    }
  }

  // Ring of "downtown": real towers cluster near the crossing, and the skyline falls away.
  for (const { x, z } of blockCenters) {
    const r = Math.hypot(x, z) / HALF;              // 0 at centre, ~1 at the edge
    // A few blocks stay open: plazas break up the wall of towers and give the eye a rest.
    if (rnd.chance(0.045) && r > 0.12) {
      plazas.push({ x, z, size: LOT });
      continue;
    }

    // A block is a terrace, not a plinth: one to four buildings share the lot, each with
    // its own height and its own shallow gap, so the street wall has rhythm.
    const inner = LOT - LOT_MARGIN * 2;
    const pieces = [];
    const roll = rnd.next();

    if (roll < 0.18) {
      // one deep building fills the block
      pieces.push({ x: 0, z: 0, w: inner - rnd.range(0, 4), d: inner - rnd.range(0, 4) });
    } else if (roll < 0.52) {
      // two along x
      const gap = 1.6 + rnd.range(0, 1.6);
      const a = (inner - gap) * rnd.range(0.38, 0.62);
      const b = inner - gap - a;
      pieces.push({ x: -(inner - a) / 2, z: rnd.range(-1.4, 1.4), w: a, d: inner - rnd.range(0, 4) });
      pieces.push({ x: (inner - b) / 2, z: rnd.range(-1.4, 1.4), w: b, d: inner - rnd.range(0, 4) });
    } else if (roll < 0.86) {
      // two along z
      const gap = 1.6 + rnd.range(0, 1.6);
      const a = (inner - gap) * rnd.range(0.38, 0.62);
      const b = inner - gap - a;
      pieces.push({ x: rnd.range(-1.4, 1.4), z: -(inner - a) / 2, w: inner - rnd.range(0, 4), d: a });
      pieces.push({ x: rnd.range(-1.4, 1.4), z: (inner - b) / 2, w: inner - rnd.range(0, 4), d: b });
    } else {
      // three: a corner tower with a low annex beside it, so the block has a silhouette
      const gap = 1.4 + rnd.range(0, 1.2);
      const wide = (inner - gap) * 0.58;
      const narrow = inner - gap - wide;
      const front = (inner - gap) * 0.62;
      pieces.push({ x: -(inner - wide) / 2, z: -(inner - front) / 2, w: wide, d: front });
      pieces.push({ x: (inner - narrow) / 2, z: -(inner - front) / 2, w: narrow, d: front });
      pieces.push({ x: rnd.range(-2, 2), z: (inner - (inner - gap - front)) / 2, w: inner - rnd.range(0, 6), d: inner - gap - front });
    }

    for (const p of pieces) {
      // Height by distance from the centre, with a tower band in the middle ring.
      let h;
      const core = 1 - Math.min(1, r / 0.62);
      if (rnd.chance(0.09 + 0.20 * core)) {
        h = rnd.range(72, 168) * (0.55 + 0.75 * core);     // the towers
      } else if (rnd.chance(0.34)) {
        h = rnd.range(9, 22);                              // low-rise fill: the street wall
      } else {
        h = rnd.range(22, 64) * (0.6 + 0.6 * core);        // the bulk
      }
      h = Math.max(8, Math.round(h / 0.9) * 0.9);

      const w = Math.max(7, Math.round(p.w * 10) / 10);
      const d = Math.max(7, Math.round(p.d * 10) / 10);
      const bx = x + p.x, bz = z + p.z;
      buildings.push({
        x: bx, z: bz, w, d, h,
        variant: rnd.int(0, 3),
        // A little lean into the block so towers do not form a perfect wall.
        tint: rnd.range(0.86, 1.06),
        faces: streetFaces(bx, bz, w, d)
      });
    }

    // A rooftop sign on some towers, facing the crossing.
    if (rnd.chance(0.10)) {
      signs.push({
        x, z,
        y: rnd.range(16, 44),
        w: rnd.range(9, 17),
        h: rnd.range(3, 6),
        yaw: rnd.chance(0.5) ? 0 : Math.PI,
        hue: rnd.range(0.5, 0.72)
      });
    }
  }

  // ---------------------------------------------------------------- street lamps
  // One every 24 m on both sides of every road, sitting on the kerb line — the arm leans
  // out over the carriageway, the post stays clear of the walking lane and the awnings.
  const occ = createOccupancy();
  // People outrank furniture: an NPC's stand spot is reserved before anything is placed,
  // so no pole or vending machine can appear inside a character.
  for (const r of (opts.reserved || [])) occ.place([], r, r.r ?? 1.05);
  const step = 24;
  for (let k = 0; k <= GRID; k++) {
    const line = -HALF + CELL * k;
    for (let p = -HALF + 12; p < HALF; p += step) {
      for (const side of [-1, 1]) {
        // Skip lamps that would land inside the road at a crossing.
        if (Math.abs((((p + HALF) % CELL) + CELL) % CELL - CELL / 2) > CELL / 2 - 8) continue;
        const off = side * (ROAD_HALF + 0.45);
        occ.place(lamps, { x: line + off, z: p, yaw: side > 0 ? Math.PI : 0 }, 0.5);
        occ.place(lamps, { x: p, z: line + off, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 }, 0.5);
      }
    }
  }

  return { buildings, plazas, lamps, signs, blockCenters, props: streetProps(rnd, plazas, occ) };
}

/**
 * The furniture that makes a street a street: vending machines against the shopfronts, a
 * utility pole line with sagging wires overhead, signals on the busier corners, trees on
 * the kerb — and an occupancy list so none of it grows through any of the rest.
 *
 * The 3 m sidewalk is split by function:
 *   6.45 m  kerb line     lamps, trees
 *   7.05 m  walking lane  the crowd (crowd.js places walkers on WALK_IN)
 *   7.45 m  walking lane  walkers going the other way
 *   7.78 m  utility poles, clear of the 1.08 m awnings overhead
 *   8.20 m  vending machines, back against the shopfronts
 * Before this split pedestrians walked through the vending machines, and the poles ran
 * straight through the awning line at 3.16 m.
 */
function createOccupancy() {
  const placed = [];
  return {
    free(x, z, r) {
      for (const p of placed) {
        const dx = x - p.x, dz = z - p.z;
        const min = r + p.r + 0.32;
        if (dx * dx + dz * dz < min * min) return false;
      }
      return true;
    },
    place(list, item, r) {
      if (!this.free(item.x, item.z, r)) return false;
      placed.push({ x: item.x, z: item.z, r });
      list.push(item);
      return true;
    }
  };
}

function streetProps(rnd, plazas, occ) {
  const props = { vending: [], poles: [], wires: [], signals: [], benches: [], trees: [] };

  const CURB = ROAD_HALF + 0.45;       // 6.45
  const POLE_OFF = ROAD_HALF + 1.78;   // 7.78
  const VEND_OFF = ROAD_HALF + 2.20;   // 8.20

  // --- trees, vending machines, poles: all along the same kerbs
  for (let k = 0; k <= GRID; k++) {
    const line = -HALF + CELL * k;

    for (const side of [-1, 1]) {
      // --- street trees on the kerb line, every 18 m, both directions
      for (let t = -HALF + 12 + (k % 2) * 9; t < HALF - 8; t += 18) {
        occ.place(props.trees, {
          x: line + side * CURB + rnd.range(-0.15, 0.15),
          z: t + rnd.range(-1.2, 1.2),
          kind: 'street', scale: rnd.range(0.85, 1.2), seed: rnd.next()
        }, 0.8);
        occ.place(props.trees, {
          x: t + rnd.range(-1.2, 1.2),
          z: line + side * CURB + rnd.range(-0.15, 0.15),
          kind: 'street', scale: rnd.range(0.85, 1.2), seed: rnd.next()
        }, 0.8);
      }

      // --- vending machines: frequent enough to read as a Japanese street, sparse enough
      // that the eye is not tripping over them
      for (let t = -HALF + 16; t < HALF; t += 24) {
        if (rnd.chance(0.22)) {
          occ.place(props.vending, {
            x: line + side * VEND_OFF,
            z: t + rnd.range(-5, 5),
            yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2
          }, 0.62);
        }
        if (rnd.chance(0.22)) {
          occ.place(props.vending, {
            x: t + rnd.range(-5, 5),
            z: line + side * VEND_OFF,
            yaw: side > 0 ? Math.PI : 0
          }, 0.62);
        }
      }

      // --- utility poles: one per block, wires strung between neighbours
      const poleZ = [];
      const poleX = [];
      for (let t = -HALF + CELL / 2; t < HALF; t += CELL) {
        if (occ.place(props.poles, { x: line + side * POLE_OFF, z: t, yaw: 0 }, 0.34)) {
          poleZ.push({ x: line + side * POLE_OFF, z: t, yaw: 0 });
        }
        if (occ.place(props.poles, { x: t, z: line + side * POLE_OFF, yaw: 0 }, 0.34)) {
          poleX.push({ x: t, z: line + side * POLE_OFF, yaw: 0 });
        }
      }
      for (let i = 1; i < poleZ.length; i++) {
        props.wires.push({ x1: poleZ[i - 1].x, z1: poleZ[i - 1].z, x2: poleZ[i].x, z2: poleZ[i].z });
      }
      for (let i = 1; i < poleX.length; i++) {
        props.wires.push({ x1: poleX[i - 1].x, z1: poleX[i - 1].z, x2: poleX[i].x, z2: poleX[i].z });
      }
    }
  }

  // --- signals on alternating corners, so not every crossing is lit
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      if ((i + j) % 2) continue;
      const px = -HALF + CELL * i;
      const pz = -HALF + CELL * j;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          if (rnd.chance(0.35)) continue;
          const sat = ROAD_HALF + 0.7;
          occ.place(props.signals, {
            x: px + sx * sat,
            z: pz + sz * sat,
            // the head faces back across the junction
            yaw: Math.atan2(-sx, -sz)
          }, 0.42);
        }
      }
    }
  }

  // --- benches and planting on the plazas, facing the open ground
  for (const p of plazas) {
    const n = rnd.int(2, 5);
    for (let i = 0; i < n; i++) {
      const a = rnd.range(0, Math.PI * 2);
      const rad = rnd.range(4, 11);
      occ.place(props.benches, {
        x: p.x + Math.cos(a) * rad,
        z: p.z + Math.sin(a) * rad,
        yaw: a + Math.PI
      }, 1.0);
    }
    // low planting: bushes at the plaza edge, the courtyard version of a hedge
    const bushes = rnd.int(5, 10);
    for (let i = 0; i < bushes; i++) {
      const a = rnd.range(0, Math.PI * 2);
      const rad = rnd.range(3.6, 12.5);
      occ.place(props.trees, {
        x: p.x + Math.cos(a) * rad,
        z: p.z + Math.sin(a) * rad,
        kind: 'bush', scale: rnd.range(0.7, 1.25), seed: rnd.next()
      }, 0.55);
    }
  }

  return props;
}

/** Axis-aligned boxes the walker cannot enter: buildings, plus the street furniture you
 *  should not be able to walk through. Each carries its own padding — an NPC-sized 0.9 m
 *  around a vending machine would block the whole pavement. */
export function collisionBoxes(layout) {
  const out = layout.buildings.map(b => ({
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    h: b.h
  }));

  const props = layout.props;
  if (props) {
    const box = (x, z, r, h, pad) => out.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, h, pad });
    for (const v of props.vending) box(v.x, v.z, 0.55, 1.9, 0.2);
    for (const b of props.benches) box(b.x, b.z, 0.85, 0.9, 0.2);
    for (const t of props.trees) box(t.x, t.z, t.kind === 'street' ? 0.3 : 0.6, 3, 0.14);
    for (const p of props.poles) box(p.x, p.z, 0.16, 7.8, 0.12);
    for (const g of props.signals) box(g.x, g.z, 0.14, 4.4, 0.12);
  }

  return out;
}