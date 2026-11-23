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

/** Sidewalk centre line, measured out from a road's centre line. */
export const WALK_IN = ROAD_HALF + 1.7;
export const WALK_OUT = ROAD_HALF + 2.5;

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

export function generateLayout(seed = 20261123) {
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
  // One every 24 m on both sides of every road, sitting on the sidewalk edge.
  const step = 24;
  for (let k = 0; k <= GRID; k++) {
    const line = -HALF + CELL * k;
    for (let p = -HALF + 12; p < HALF; p += step) {
      for (const side of [-1, 1]) {
        // Skip lamps that would land inside the road at a crossing.
        if (Math.abs((((p + HALF) % CELL) + CELL) % CELL - CELL / 2) > CELL / 2 - 8) continue;
        lamps.push({ x: line + side * (ROAD_HALF + 1.2), z: p, yaw: side > 0 ? Math.PI : 0 });
        lamps.push({ x: p, z: line + side * (ROAD_HALF + 1.2), yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
      }
    }
  }

  return { buildings, plazas, lamps, signs, blockCenters, props: streetProps(rnd, plazas) };
}

/**
 * The furniture that makes a street a street: vending machines against the kerb, a
 * utility pole line with sagging wires overhead, and signals on the busier corners.
 * All of it is data; frontage.js turns it into three merged meshes.
 */
function streetProps(rnd, plazas) {
  const props = { vending: [], poles: [], wires: [], signals: [], benches: [] };

  // --- roads run both ways at every grid line; furniture lives on the sidewalk band
  for (let k = 0; k <= GRID; k++) {
    const line = -HALF + CELL * k;

    for (const side of [-1, 1]) {
      const off = side * WALK_IN;

      // vending machines: frequent enough to read as a Japanese street, sparse enough
      // that the eye is not tripping over them
      for (let t = -HALF + 16; t < HALF; t += 24) {
        if (rnd.chance(0.22)) {
          const jitter = rnd.range(-5, 5);
          // along a road that runs in z (fixed x = line)
          props.vending.push({ x: line + off, z: t + jitter, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
        }
        if (rnd.chance(0.22)) {
          const jitter = rnd.range(-5, 5);
          props.vending.push({ x: t + jitter, z: line + off, yaw: side > 0 ? Math.PI : 0 });
        }
      }

      // utility poles: one per block, wires strung between neighbours
      const poleZ = [];
      const poleX = [];
      for (let t = -HALF + CELL / 2; t < HALF; t += CELL) {
        poleZ.push({ x: line + side * WALK_OUT, z: t, yaw: 0 });
        poleX.push({ x: t, z: line + side * WALK_OUT, yaw: 0 });
      }
      props.poles.push(...poleZ, ...poleX);
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
          props.signals.push({
            x: px + sx * WALK_IN,
            z: pz + sz * WALK_IN,
            // the head faces back across the junction
            yaw: Math.atan2(-sx, -sz)
          });
        }
      }
    }
  }

  // --- benches and planters on the plazas, facing the open ground
  for (const p of plazas) {
    const n = rnd.int(2, 5);
    for (let i = 0; i < n; i++) {
      const a = rnd.range(0, Math.PI * 2);
      const rad = rnd.range(4, 11);
      props.benches.push({
        x: p.x + Math.cos(a) * rad,
        z: p.z + Math.sin(a) * rad,
        yaw: a + Math.PI
      });
    }
  }

  return props;
}

/** Axis-aligned boxes the walker cannot enter (buildings only; plazas are walkable). */
export function collisionBoxes(layout) {
  return layout.buildings.map(b => ({
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
    h: b.h
  }));
}