// Every texture in the city is drawn at load time on a <canvas>, so the project ships
// no image dependencies beyond the character sprites. Textures are cached: the same
// request returns the same THREE.Texture instance (and therefore the same upload).

import * as THREE from 'three';
import { makeRandom, TAU } from './random.js';

const cache = new Map();

function canvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  return c;
}

function toTexture(c, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- noise
// Seamless value noise on the unit square: the lattice wraps, so a map sampled with
// RepeatWrapping has no visible seam. Every surface below is built from these.

function valueNoise(cells, seed) {
  const rnd = makeRandom(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd.next();
  const wrap = n => ((n % cells) + cells) % cells;
  const at = (i, j) => g[wrap(j) * cells + wrap(i)];
  return (u, v) => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    const top = a + (b - a) * sx;
    const bot = c + (d - c) * sx;
    return top + (bot - top) * sy;
  };
}

const gray = v => {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${n},${n},${n})`;
};

// ---------------------------------------------------------------- building facades
// A facade tile holds COLS x ROWS bays and ships as a matched set of four maps:
//   albedo     wall, frames, glass, sills, grime
//   emissive   only the lit bays, so the glow lands exactly on the glass
//   bump       glass recessed, frames and sills proud (grey = height)
//   roughness  glass smooth, render rough, so sunsets roll off the towers
// Four styles, picked by height in city.js, keep the skyline from reading as one material.

const COLS = 6, ROWS = 6, TILE = 512;

const STYLES = {
  concrete: {
    wall: '#8b8679', glass: '#1d2732', frame: '#b3ae9f',
    lit: ['#ffdda2', '#ffeccb', '#cfe0ff'], litChance: 0.32,
    bay: 'window', balcony: 0.28, ac: 0.24
  },
  curtain: {
    wall: '#454f5c', glass: '#0f171f', frame: '#6d7581', spandrel: '#29313a',
    lit: ['#ffeccd', '#dde9ff', '#bfd6ff'], litChance: 0.20,
    bay: 'glass', balcony: 0, ac: 0
  },
  ribbon: {
    wall: '#9b9080', glass: '#19222b', frame: '#bdb3a0', spandrel: '#6e6659',
    lit: ['#fff1cf', '#ffe3b3', '#d7e7ff'], litChance: 0.38,
    bay: 'band', balcony: 0.10, ac: 0.08
  },
  brick: {
    wall: '#8a6050', glass: '#20272d', frame: '#d6cdbe',
    lit: ['#ffd79a', '#ffe8bf', '#e6d1ff'], litChance: 0.30,
    bay: 'window', balcony: 0.38, ac: 0.14, brick: true
  }
};

export const FACADE_STYLES = ['concrete', 'curtain', 'ribbon', 'brick'];
export const FACADE_VARIANTS = FACADE_STYLES.length;

/** Which style a building should wear. Glass towers, ribbon offices, masonry low-rise. */
export function styleForBuilding(b) {
  if (b.h > 62) return 1;                    // curtain wall
  if (b.h > 30) return 2;                    // ribbon office
  return b.variant % 2 ? 3 : 0;              // brick / concrete walk-ups
}

function facadeBays(style, seed) {
  const rnd = makeRandom(seed);
  const cw = TILE / COLS, ch = TILE / ROWS;
  const bays = [];
  for (let r = 0; r < ROWS; r++) {
    const floorLit = rnd.chance(style.bay === 'band' ? 0.16 : 0.06);
    for (let c = 0; c < COLS; c++) {
      bays.push({
        c, r, cw, ch, x: c * cw, y: r * ch,
        lit: rnd.chance(style.litChance) || (floorLit && rnd.chance(0.7)),
        tint: rnd.pick(style.lit),
        glow: rnd.range(0.5, 1),
        balcony: rnd.chance(style.balcony),
        ac: rnd.chance(style.ac),
        split: style.bay === 'window' && rnd.chance(0.2),
        blind: rnd.chance(0.3),
        grime: rnd.chance(0.24)
      });
    }
  }
  return bays;
}

/** Glass rectangles of one bay, in tile pixels. */
function panesOf(style, b) {
  const { x, y, cw, ch } = b;
  if (style.bay === 'glass') return [[x + cw * 0.05, y + ch * 0.06, cw * 0.90, ch * 0.72]];
  if (style.bay === 'band') return [[x, y + ch * 0.30, cw, ch * 0.42]];
  if (b.split) {
    const w = cw * 0.24, py = ch * 0.24, ph = ch * 0.40;
    return [[x + cw * 0.11, y + py, w, ph], [x + cw * 0.62, y + py, w, ph]];
  }
  return [[x + cw * 0.20, y + ch * 0.24, cw * 0.60, ch * 0.40]];
}

function facadePair(style, seed) {
  const rnd = makeRandom(seed);
  const bays = facadeBays(style, seed);
  const S = TILE;
  const spandrel = style.spandrel || style.glass;

  // ---- albedo -------------------------------------------------------------
  const albedo = canvas(S, (ctx) => {
    ctx.fillStyle = style.wall;
    ctx.fillRect(0, 0, S, S);

    // break up the render so an 18 m tile does not read as one flat panel
    for (let i = 0; i < 2200; i++) {
      const white = rnd.chance(0.5);
      ctx.fillStyle = `rgba(${white ? '255,255,255' : '0,0,0'},${rnd.range(0.012, 0.05)})`;
      ctx.fillRect(rnd.range(0, S), rnd.range(0, S), rnd.range(2, 20), rnd.range(2, 9));
    }

    if (style.brick) {
      const bh = S / 26;
      for (let row = 0; row * bh < S; row++) {
        ctx.fillStyle = 'rgba(38,24,18,.26)';
        ctx.fillRect(0, row * bh, S, 1.5);
        const off = (row % 2) * bh * 1.1;
        for (let x = off; x < S; x += bh * 2.2) ctx.fillRect(x, row * bh, 1.5, bh);
      }
    }

    // floor slabs: shadow under each floor line, thin highlight above it
    for (let r = 0; r <= ROWS; r++) {
      const y = Math.round(r * S / ROWS);
      ctx.fillStyle = 'rgba(0,0,0,.20)';
      ctx.fillRect(0, y - 2, S, 3);
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.fillRect(0, y + 1, S, 1);
    }
    // vertical pilasters at bay edges
    ctx.fillStyle = 'rgba(255,255,255,.045)';
    for (let c = 1; c < COLS; c++) ctx.fillRect(Math.round(c * S / COLS) - 1, 0, 2, S);

    for (const b of bays) {
      const frame = style.bay === 'band' ? 2 : 3;

      if (style.bay === 'band') {
        // continuous ribbon: spandrel band behind the glass strip
        ctx.fillStyle = spandrel;
        ctx.fillRect(b.x, b.y + b.ch * 0.16, b.cw, b.ch * 0.68);
      }

      for (const [gx, gy, gw, gh] of panesOf(style, b)) {
        // recess shadow + frame
        ctx.fillStyle = 'rgba(0,0,0,.40)';
        ctx.fillRect(gx - frame, gy - frame, gw + frame * 2, gh + frame * 2);
        ctx.fillStyle = style.frame;
        ctx.fillRect(gx - frame, gy - frame, gw + frame * 2, frame);
        ctx.fillRect(gx - frame, gy + gh, gw + frame * 2, frame);
        ctx.fillRect(gx - frame, gy - frame, frame, gh + frame * 2);
        ctx.fillRect(gx + gw, gy - frame, frame, gh + frame * 2);

        // glass, with the sky reflected down the top third
        ctx.fillStyle = style.glass;
        ctx.fillRect(gx, gy, gw, gh);
        const refl = ctx.createLinearGradient(gx, gy, gx, gy + gh);
        refl.addColorStop(0, 'rgba(150,178,205,.34)');
        refl.addColorStop(0.45, 'rgba(26,36,46,0)');
        ctx.fillStyle = refl;
        ctx.fillRect(gx, gy, gw, gh);

        if (b.lit) {
          ctx.globalAlpha = 0.46 * b.glow;
          ctx.fillStyle = b.tint;
          ctx.fillRect(gx, gy, gw, gh);
          ctx.globalAlpha = 1;
        }
        if (b.blind) {
          ctx.fillStyle = 'rgba(236,232,220,.20)';
          ctx.fillRect(gx, gy, gw, gh * 0.34);
        }

        // mullion + transom
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = style.frame;
        ctx.fillRect(Math.round(gx + gw / 2) - 1, gy, 2, gh);
        if (gh > 30) ctx.fillRect(gx, Math.round(gy + gh * 0.36), gw, 1.5);
        ctx.globalAlpha = 1;

        // sill highlight catches the low sun
        ctx.fillStyle = 'rgba(255,255,255,.20)';
        ctx.fillRect(gx - frame, gy + gh + frame, gw + frame * 2, 1.5);
      }

      if (b.balcony) {
        const by = b.y + b.ch * 0.70, bh = b.ch * 0.14;
        ctx.fillStyle = 'rgba(250,248,244,.13)';
        ctx.fillRect(b.x + 2, by, b.cw - 4, bh);
        ctx.fillStyle = 'rgba(0,0,0,.30)';
        ctx.fillRect(b.x + 2, by + bh, b.cw - 4, 3);
        ctx.fillStyle = 'rgba(206,210,216,.5)';
        for (let i = 0; i <= 8; i++) {
          ctx.fillRect(b.x + 4 + i * ((b.cw - 8) / 8), by - bh * 1.4, 1.5, bh * 1.4);
        }
        ctx.fillRect(b.x + 4, by - bh * 1.4, b.cw - 8, 2);
      } else if (b.ac) {
        const aw = b.cw * 0.26, ah = aw * 0.62;
        const ax = b.x + b.cw * 0.5 - aw / 2, ay = b.y + b.ch * 0.70;
        ctx.fillStyle = '#9aa0a6';
        ctx.fillRect(ax, ay, aw, ah);
        ctx.fillStyle = 'rgba(0,0,0,.34)';
        for (let i = 1; i < 5; i++) ctx.fillRect(ax + 2, ay + (i * ah) / 5, aw - 4, 1);
        ctx.fillRect(ax, ay + ah, aw, 2);
      }

      if (b.grime) {
        const g = ctx.createLinearGradient(0, b.y + b.ch * 0.60, 0, b.y + b.ch);
        g.addColorStop(0, 'rgba(18,20,24,.20)');
        g.addColorStop(1, 'rgba(18,20,24,0)');
        ctx.fillStyle = g;
        ctx.fillRect(b.x + b.cw * 0.28, b.y + b.ch * 0.60, b.cw * 0.16, b.ch * 0.40);
      }
    }
  });

  // ---- emissive -----------------------------------------------------------
  const emissive = canvas(S, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    for (const b of bays) {
      if (!b.lit) continue;
      for (const [gx, gy, gw, gh] of panesOf(style, b)) {
        ctx.save();
        ctx.shadowColor = b.tint;
        ctx.shadowBlur = 16;
        ctx.globalAlpha = 0.55 + 0.45 * b.glow;
        ctx.fillStyle = b.tint;
        ctx.fillRect(gx, gy, gw, gh);
        ctx.restore();
        // furniture / figure silhouette keeps lit rooms from reading as flat cards
        ctx.fillStyle = 'rgba(0,0,0,.30)';
        ctx.fillRect(gx, gy + gh * 0.62, gw, gh * 0.38);
        if (b.blind) {
          ctx.fillStyle = 'rgba(255,255,255,.45)';
          for (let i = 0; i < 7; i++) ctx.fillRect(gx, gy + (i * gh) / 7, gw, 1.2);
        }
      }
    }
  });

  // ---- bump ---------------------------------------------------------------
  const bump = canvas(S, (ctx) => {
    ctx.fillStyle = gray(124);
    ctx.fillRect(0, 0, S, S);

    if (style.brick) {
      ctx.fillStyle = gray(96);
      for (let row = 0; row * (S / 26) < S; row++) ctx.fillRect(0, row * (S / 26), S, 2);
    }
    for (let i = 0; i < 1200; i++) {
      ctx.fillStyle = gray(124 + rnd.range(-18, 18));
      ctx.fillRect(rnd.range(0, S), rnd.range(0, S), rnd.range(2, 12), rnd.range(2, 8));
    }
    for (let r = 0; r <= ROWS; r++) {
      ctx.fillStyle = gray(98);
      ctx.fillRect(0, Math.round(r * S / ROWS) - 2, S, 3);
    }
    for (const b of bays) {
      const frame = style.bay === 'band' ? 2 : 3;
      for (const [gx, gy, gw, gh] of panesOf(style, b)) {
        ctx.fillStyle = gray(58);                       // glass sits back
        ctx.fillRect(gx, gy, gw, gh);
        ctx.fillStyle = gray(196);                      // frames stand proud
        ctx.fillRect(gx - frame, gy - frame, gw + frame * 2, frame);
        ctx.fillRect(gx - frame, gy + gh, gw + frame * 2, frame);
        ctx.fillRect(gx - frame, gy - frame, frame, gh + frame * 2);
        ctx.fillRect(gx + gw, gy - frame, frame, gh + frame * 2);
        ctx.fillStyle = gray(218);                      // sill lip
        ctx.fillRect(gx - frame, gy + gh + frame, gw + frame * 2, 2);
      }
      if (b.balcony) {
        const by = b.y + b.ch * 0.70, bh = b.ch * 0.14;
        ctx.fillStyle = gray(206);
        ctx.fillRect(b.x + 2, by, b.cw - 4, bh);
        ctx.fillStyle = gray(60);
        ctx.fillRect(b.x + 2, by + bh, b.cw - 4, 3);
      } else if (b.ac) {
        ctx.fillStyle = gray(184);
        ctx.fillRect(b.x + b.cw * 0.37, b.y + b.ch * 0.70, b.cw * 0.26, b.cw * 0.16);
      }
    }
  });

  // ---- roughness ----------------------------------------------------------
  const rough = canvas(S, (ctx) => {
    ctx.fillStyle = gray(212);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = gray(212 + rnd.range(-16, 16));
      ctx.fillRect(rnd.range(0, S), rnd.range(0, S), rnd.range(3, 16), rnd.range(3, 12));
    }
    if (style.bay === 'band') {
      ctx.fillStyle = gray(176);
      for (const b of bays) ctx.fillRect(b.x, b.y + b.ch * 0.16, b.cw, b.ch * 0.68);
    }
    for (const b of bays) {
      for (const [gx, gy, gw, gh] of panesOf(style, b)) {
        ctx.fillStyle = gray(26);                       // glass is nearly a mirror
        ctx.fillRect(gx, gy, gw, gh);
      }
      if (b.balcony) {
        ctx.fillStyle = gray(168);
        ctx.fillRect(b.x + 2, b.y + b.ch * 0.70, b.cw - 4, b.ch * 0.14);
      }
    }
  });

  return { albedo, emissive, bump, rough };
}

/** @returns {{map, emissiveMap, bumpMap, roughnessMap}} */
export function facadeTextures(styleIndex = 0) {
  const key = `facade${styleIndex}`;
  if (cache.has(key)) return cache.get(key);
  const name = FACADE_STYLES[styleIndex % FACADE_STYLES.length];
  const set = facadePair(STYLES[name], 9001 + styleIndex * 7919);
  const out = {
    map: toTexture(set.albedo, { repeat: 1 }),
    emissiveMap: toTexture(set.emissive, { repeat: 1 }),
    bumpMap: toTexture(set.bump, { repeat: 1, srgb: false }),
    roughnessMap: toTexture(set.rough, { repeat: 1, srgb: false })
  };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- ground
// One tile == one city cell, measured corner to corner between two road centre lines:
//   |<-6m road->|<-3m walk->|<-30m block->|<-3m walk->|<-6m road->|
// Roads sit on the tile's edges, so the tile repeats seamlessly across the grid.
//
// The tile ships as albedo + bump + roughness: wet asphalt needs a low roughness to
// mirror the dusk sky, pavers need a high one, and the joints have to catch light or
// the whole street reads as painted cardboard.

export const GROUND_TILE_METERS = 48;

export function groundMaps() {
  const key = 'ground-maps';
  if (cache.has(key)) return cache.get(key);

  const S = 1024;
  const px = S / GROUND_TILE_METERS;
  const rnd = makeRandom(4242);
  const road = 6 * px;                    // 6 m carriageway on every edge
  const walk = 3 * px;                    // 3 m sidewalk
  const lot0 = Math.round(road + walk);
  const lot1 = S - lot0;

  const grain = valueNoise(220, 11);
  const broad = valueNoise(18, 17);

  // 0 asphalt, 1 sidewalk, 2 lot
  const zoneAt = (mx, my) => {
    const d = Math.min(Math.min(mx, GROUND_TILE_METERS - mx), Math.min(my, GROUND_TILE_METERS - my));
    return d < 6 ? 0 : d < 9 ? 1 : 2;
  };

  const puddles = [];
  for (let i = 0; i < 9; i++) {
    puddles.push({
      x: rnd.range(0.04, 0.96) * S,
      y: rnd.range(0.04, 0.96) * S,
      rx: rnd.range(0.02, 0.075) * S,
      ry: rnd.range(0.012, 0.045) * S
    });
  }

  // ---- albedo -------------------------------------------------------------
  const albedo = document.createElement('canvas');
  albedo.width = albedo.height = S;
  const a = albedo.getContext('2d', { willReadFrequently: true });

  // Albedo is deliberately mid-grey, not "wet asphalt black": these are daytime surfaces,
  // and the shadowing on a street between towers already costs two stops. Fresh-looking
  // #25292f read as a black hole at 17:52 and only recovered after dark.
  a.fillStyle = '#474e57';
  a.fillRect(0, 0, S, S);
  a.fillStyle = '#868b94';
  a.fillRect(road, road, S - road * 2, S - road * 2);
  a.fillStyle = '#747a83';
  a.fillRect(lot0, lot0, lot1 - lot0, lot1 - lot0);

  // mottle every pixel (sampled on a 2 px grid: the grain is finer than the eye reads)
  {
    const img = a.getImageData(0, 0, S, S);
    const d = img.data;
    for (let y = 0; y < S; y += 2) {
      const my = y / px, v = y / S;
      for (let x = 0; x < S; x += 2) {
        const u = x / S;
        const z = zoneAt(x / px, my);
        const g = grain(u, v), b = broad(u, v);
        const m = z === 0 ? 0.86 + 0.30 * b + 0.20 * g
          : z === 1 ? 0.92 + 0.16 * g + 0.06 * b
            : 0.90 + 0.15 * b + 0.09 * g;
        for (let dy = 0; dy < 2; dy++) {
          const row = ((y + dy) * S + x) * 4;
          for (let dx = 0; dx < 2; dx++) {
            const i = row + dx * 4;
            d[i] = d[i] * m;
            d[i + 1] = d[i + 1] * m;
            d[i + 2] = d[i + 2] * m;
          }
        }
      }
    }
    a.putImageData(img, 0, 0);
  }

  // sidewalk pavers: 0.6 m squares with grouted joints, along all four bands of the ring
  a.strokeStyle = 'rgba(34,38,44,.55)';
  a.lineWidth = 1.4;
  const paver = px * 0.6;
  const ringA = road, ringD = S - road;
  for (let d = 0; d <= walk; d += paver) {
    // joints running along the street, inside the top and bottom bands
    for (const y of [ringA + d, ringD - d]) {
      a.beginPath(); a.moveTo(ringA, y); a.lineTo(ringD, y); a.stroke();
    }
    // joints running across it, inside the left and right bands
    for (const x of [ringA + d, ringD - d]) {
      a.beginPath(); a.moveTo(x, ringA); a.lineTo(x, ringD); a.stroke();
    }
  }

  // curb: a pale stone edge, then the gutter stain that always sits beside it
  a.strokeStyle = '#8d9199';
  a.lineWidth = px * 0.34;
  a.strokeRect(road, road, S - road * 2, S - road * 2);
  a.strokeStyle = 'rgba(16,18,22,.34)';
  a.lineWidth = px * 0.5;
  a.strokeRect(road - px * 0.45, road - px * 0.45, S - road * 2 + px * 0.9, S - road * 2 + px * 0.9);

  // lot slabs: 3 m cast panels
  a.strokeStyle = 'rgba(30,34,40,.5)';
  a.lineWidth = 2;
  for (let p = lot0; p <= lot1; p += px * 3) {
    a.beginPath(); a.moveTo(p, lot0); a.lineTo(p, lot1); a.stroke();
    a.beginPath(); a.moveTo(lot0, p); a.lineTo(lot1, p); a.stroke();
  }

  // asphalt repairs: tar seams and a couple of patches
  a.strokeStyle = 'rgba(12,14,18,.55)';
  a.lineWidth = 2.5;
  for (let i = 0; i < 7; i++) {
    const y0 = rnd.range(0, S), x0 = rnd.range(0, S);
    a.beginPath();
    a.moveTo(x0, y0);
    let x = x0, y = y0;
    for (let k = 0; k < 6; k++) {
      x += rnd.range(-40, 40);
      y += rnd.range(-26, 26);
      a.lineTo(x, y);
    }
    a.stroke();
  }

  // puddles: dark, cool, and they get a mirror-smooth roughness below
  for (const p of puddles) {
    const g = a.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(p.rx, p.ry));
    g.addColorStop(0, 'rgba(28,38,52,.50)');
    g.addColorStop(0.7, 'rgba(30,40,54,.30)');
    g.addColorStop(1, 'rgba(34,44,58,0)');
    a.fillStyle = g;
    a.save();
    a.translate(p.x, p.y);
    a.scale(1, p.ry / p.rx);
    a.beginPath(); a.arc(0, 0, p.rx, 0, TAU); a.fill();
    a.restore();
  }

  // manhole covers
  for (let i = 0; i < 3; i++) {
    const cx = rnd.range(road * 1.5, S - road * 1.5);
    const cy = rnd.chance(0.5) ? rnd.range(road * 1.2, road * 2.6) : rnd.range(S - road * 2.6, S - road * 1.2);
    const r = px * 0.34;
    a.fillStyle = '#3d4249';
    a.beginPath(); a.arc(cx, cy, r, 0, TAU); a.fill();
    a.strokeStyle = 'rgba(150,156,164,.5)';
    a.lineWidth = 1.5;
    a.beginPath(); a.arc(cx, cy, r * 0.82, 0, TAU); a.stroke();
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * TAU;
      a.beginPath();
      a.moveTo(cx + Math.cos(t) * r * 0.3, cy + Math.sin(t) * r * 0.3);
      a.lineTo(cx + Math.cos(t) * r * 0.72, cy + Math.sin(t) * r * 0.72);
      a.stroke();
    }
  }

  // ---- lane markings ------------------------------------------------------
  // Dashes are drawn as many short segments with a per-segment alpha so the paint
  // looks worn rather than printed.
  const paint = (x, y, w, h, alpha) => {
    a.fillStyle = `rgba(232,228,208,${alpha})`;
    a.fillRect(x, y, w, h);
  };
  const dash = px * 3, gap = px * 3;
  // each dash gets its own alpha, so the paint looks worn instead of printed
  for (let p = 0; p < S; p += dash + gap) {
    paint(0, p, px * 0.22, dash, rnd.range(0.42, 0.72));
    paint(S - px * 0.22, p, px * 0.22, dash, rnd.range(0.42, 0.72));
    paint(p, 0, dash, px * 0.22, rnd.range(0.42, 0.72));
    paint(p, S - px * 0.22, dash, px * 0.22, rnd.range(0.42, 0.72));
  }
  // solid lane edges at +/-5 m from the centre line
  for (const at of [px * 5, S - px * 5]) {
    paint(at - 1.2, 0, 2.4, S, 0.22);
    paint(0, at - 1.2, S, 2.4, 0.22);
  }
  // stop bars just inside each crossing
  for (const at of [px * 2.2, S - px * 2.2]) {
    paint(at, road * 1.06, 2.4, road * 0.9, 0.30);
    paint(at, S - road * 1.96, 2.4, road * 0.9, 0.30);
    paint(road * 1.06, at, road * 0.9, 2.4, 0.30);
    paint(S - road * 1.96, at, road * 0.9, 2.4, 0.30);
  }
  // zebra at each corner
  for (const [zx, zy] of [[0, 0], [S, 0], [0, S], [S, S]]) {
    for (let i = 0; i < 5; i++) {
      const off = (i - 2) * px * 1.05;
      const cx = Math.max(0, Math.min(S - px * 2.2, zx - px * 1.1));
      const cy = Math.max(0, Math.min(S - px * 0.5, zy + off));
      paint(cx, cy, px * 2.2, px * 0.48, 0.42);
      const cy2 = Math.max(0, Math.min(S - px * 2.2, zy - px * 1.1));
      const cx2 = Math.max(0, Math.min(S - px * 0.5, zx + off));
      paint(cx2, cy2, px * 0.48, px * 2.2, 0.42);
    }
  }
  // tyre wear: two darker ribbons per carriageway, where wheels actually run
  a.fillStyle = 'rgba(14,16,20,.10)';
  for (const lane of [px * 1.6, px * 3.3, S - px * 1.6, S - px * 3.3]) {
    a.fillRect(0, lane - px * 0.42, S, px * 0.84);
    a.fillRect(lane - px * 0.42, 0, px * 0.84, S);
  }

  // ---- bump ---------------------------------------------------------------
  const bumpC = document.createElement('canvas');
  bumpC.width = bumpC.height = S;
  const bp = bumpC.getContext('2d', { willReadFrequently: true });
  bp.fillStyle = gray(122);
  bp.fillRect(0, 0, S, S);
  bp.fillStyle = gray(126);
  bp.fillRect(road, road, S - road * 2, S - road * 2);
  bp.fillStyle = gray(132);
  bp.fillRect(lot0, lot0, lot1 - lot0, lot1 - lot0);
  {
    const img = bp.getImageData(0, 0, S, S);
    const d = img.data;
    for (let y = 0; y < S; y += 2) {
      const v = y / S;
      for (let x = 0; x < S; x += 2) {
        const g = grain(x / S, v);
        const m = (g - 0.5) * 44;
        for (let dy = 0; dy < 2; dy++) {
          const row = ((y + dy) * S + x) * 4;
          for (let dx = 0; dx < 2; dx++) {
            const i = row + dx * 4;
            const val = Math.max(0, Math.min(255, d[i] + m));
            d[i] = d[i + 1] = d[i + 2] = val;
          }
        }
      }
    }
    bp.putImageData(img, 0, 0);
  }
  // joints and cracks read as grooves
  bp.strokeStyle = gray(74);
  bp.lineWidth = 2;
  for (let d = 0; d <= walk; d += paver) {
    for (const y of [ringA + d, ringD - d]) { bp.beginPath(); bp.moveTo(ringA, y); bp.lineTo(ringD, y); bp.stroke(); }
    for (const x of [ringA + d, ringD - d]) { bp.beginPath(); bp.moveTo(x, ringA); bp.lineTo(x, ringD); bp.stroke(); }
  }
  bp.strokeStyle = gray(70);
  bp.lineWidth = 2.5;
  bp.strokeRect(road, road, S - road * 2, S - road * 2);
  bp.strokeStyle = gray(96);
  bp.lineWidth = 2;
  for (let p = lot0; p <= lot1; p += px * 3) {
    bp.beginPath(); bp.moveTo(p, lot0); bp.lineTo(p, lot1); bp.stroke();
    bp.beginPath(); bp.moveTo(lot0, p); bp.lineTo(lot1, p); bp.stroke();
  }

  // ---- roughness ----------------------------------------------------------
  const roughC = document.createElement('canvas');
  roughC.width = roughC.height = S;
  const rp = roughC.getContext('2d');
  rp.fillStyle = gray(214);                                    // asphalt: matte
  rp.fillRect(0, 0, S, S);
  rp.fillStyle = gray(198);
  rp.fillRect(road, road, S - road * 2, S - road * 2);
  rp.fillStyle = gray(204);
  rp.fillRect(lot0, lot0, lot1 - lot0, lot1 - lot0);
  for (let i = 0; i < 1400; i++) {
    rp.fillStyle = gray(196 + rnd.range(-26, 26));
    rp.fillRect(rnd.range(0, S), rnd.range(0, S), rnd.range(3, 22), rnd.range(3, 14));
  }
  // wet patches mirror the sky: this is what makes the street read as damp at dusk
  for (const p of puddles) {
    const g = rp.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(p.rx, p.ry));
    g.addColorStop(0, gray(52));
    g.addColorStop(0.72, gray(96));
    g.addColorStop(1, gray(198));
    rp.fillStyle = g;
    rp.save();
    rp.translate(p.x, p.y);
    rp.scale(1, p.ry / p.rx);
    rp.beginPath(); rp.arc(0, 0, p.rx, 0, TAU); rp.fill();
    rp.restore();
  }
  // paint is smoother than the road it sits on
  rp.fillStyle = gray(160);
  for (let p = 0; p < S; p += dash + gap) {
    rp.fillRect(0, p, px * 0.22, dash);
    rp.fillRect(S - px * 0.22, p, px * 0.22, dash);
    rp.fillRect(p, 0, dash, px * 0.22);
    rp.fillRect(p, S - px * 0.22, dash, px * 0.22);
  }

  const out = {
    map: toTexture(albedo, { repeat: 1 }),
    bumpMap: toTexture(bumpC, { repeat: 1, srgb: false }),
    roughnessMap: toTexture(roughC, { repeat: 1, srgb: false })
  };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------- clouds
// Soft cumulus clumps with a flat, sunlit underside — the single strongest cue that
// says "this is a Shinkai sky" rather than a plain gradient.

export function cloudTexture(variant = 0) {
  const key = `cloud${variant}`;
  if (cache.has(key)) return cache.get(key);

  const S = 512;
  const rnd = makeRandom(700 + variant * 131);
  const c = canvas(S, (ctx) => {
    ctx.clearRect(0, 0, S, S);
    // Sparse clusters, not an even sheet. An even spread of 150 puffs overlaps into a
    // solid white lid: the alpha saturates everywhere and the sky loses its gradient.
    // Clustering leaves real holes between cloud groups, which is what reads as sky.
    ctx.filter = 'blur(7px)';
    const CLUSTERS = 9 + (variant % 3);
    for (let k = 0; k < CLUSTERS; k++) {
      const gx = rnd.range(0.05, 0.95) * S;
      const gy = rnd.range(0.18, 0.86) * S;
      const spread = rnd.range(0.07, 0.17) * S;
      const puffs = 16 + Math.floor(rnd.range(0, 12));
      for (let i = 0; i < puffs; i++) {
        const a0 = rnd.next() * TAU;
        const rr = Math.pow(rnd.next(), 0.7) * spread;
        const cx = gx + Math.cos(a0) * rr;
        const cy = gy + Math.sin(a0) * rr * 0.52; // flattened, cloud-like
        const r = rnd.range(0.05, 0.105) * S;
        const a = rnd.range(0.16, 0.34);
        const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.5, `rgba(250,248,246,${a * 0.62})`);
        g.addColorStop(1, 'rgba(242,240,240,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.filter = 'none';
  });

  const t = toTexture(c, { repeat: 1 });
  cache.set(key, t);
  return t;
}

export const CLOUD_VARIANTS = 3;

// ---------------------------------------------------------------- glow sprite
// A radial falloff used for the sun disc halo and for the headlight-style pools of
// light under the street lamps.

export function glowTexture(inner = 'rgba(255,240,214,1)', outer = 'rgba(255,190,120,0)') {
  const key = `glow${inner}${outer}`;
  if (cache.has(key)) return cache.get(key);
  const S = 256;
  const c = canvas(S, (ctx) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, inner);
    g.addColorStop(.18, 'rgba(255,232,196,.62)');
    g.addColorStop(.45, 'rgba(255,198,140,.18)');
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });
  const t = toTexture(c, { repeat: 1 });
  cache.set(key, t);
  return t;
}

// ---------------------------------------------------------------- shopfronts
// The street level is what makes a city read as inhabited rather than as a model: a
// ground-floor band of lit windows, awnings and name boards. All of it is packed into
// three atlases so the whole frontage costs a handful of draw calls.
//
// A cell is one shop. The albedo and the emissive are the same image: the interior is
// what glows, so one upload serves both.

const SHOP_COLS = 4, SHOP_ROWS = 4, SHOP_CELL = 256;
export const SHOP_ATLAS = { cols: SHOP_COLS, rows: SHOP_ROWS };

export function shopAtlas() {
  const key = 'shop-atlas';
  if (cache.has(key)) return cache.get(key);

  const S = SHOP_CELL * SHOP_COLS;
  const rnd = makeRandom(5511);

  const c = canvas(S, (ctx) => {
    for (let row = 0; row < SHOP_ROWS; row++) {
      for (let col = 0; col < SHOP_COLS; col++) {
        const x = col * SHOP_CELL, y = row * SHOP_CELL;
        const W = SHOP_CELL, H = SHOP_CELL;
        const roll = rnd.next();
        const closed = roll > 0.84;
        const cool = roll > 0.66 && roll <= 0.84;

        // --- the recess / frame
        ctx.fillStyle = '#161a20';
        ctx.fillRect(x, y, W, H);
        const pad = 13;
        const iw = W - pad * 2, ih = H - pad * 2, ix = x + pad, iy = y + pad;

        if (closed) {
          // A shuttered unit still belongs to the street: slats, a handrail, a dim slit.
          ctx.fillStyle = '#5d646e';
          ctx.fillRect(ix, iy, iw, ih);
          ctx.fillStyle = 'rgba(0,0,0,.22)';
          for (let s = 0; s < 14; s++) ctx.fillRect(ix, iy + s * (ih / 14), iw, 3);
          ctx.fillStyle = 'rgba(255,214,150,.20)';
          ctx.fillRect(ix, iy + ih - 26, iw, 5);
        } else {
          // --- interior: a warm (or cool) box, brighter at the back top
          const g = ctx.createLinearGradient(ix, iy, ix, iy + ih);
          if (cool) {
            g.addColorStop(0, '#f4fbff');
            g.addColorStop(0.45, '#dcefff');
            g.addColorStop(1, '#8fb4cc');
          } else {
            g.addColorStop(0, '#ffe9bf');
            g.addColorStop(0.42, '#ffd08b');
            g.addColorStop(1, '#b97a3e');
          }
          ctx.fillStyle = g;
          ctx.fillRect(ix, iy, iw, ih);

          // hanging lamps across the ceiling
          ctx.fillStyle = cool ? 'rgba(255,255,255,.92)' : 'rgba(255,247,224,.95)';
          const lamps = rnd.int(2, 3);
          for (let l = 0; l < lamps; l++) {
            const lx = ix + iw * ((l + 0.5) / lamps);
            ctx.fillRect(lx - iw * 0.10, iy + 12, iw * 0.20, 7);
          }

          // shelves / a back counter, so the glass has depth behind it
          ctx.fillStyle = 'rgba(90,52,24,.30)';
          ctx.fillRect(ix + iw * 0.06, iy + ih * 0.30, iw * 0.88, 6);
          ctx.fillRect(ix + iw * 0.06, iy + ih * 0.46, iw * 0.88, 5);
          // goods: little blocks of colour on the shelves
          for (let i = 0; i < 16; i++) {
            ctx.fillStyle = `hsla(${Math.round(rnd.range(0, 360))}, 62%, ${Math.round(rnd.range(48, 78))}%, .55)`;
            ctx.fillRect(ix + iw * (0.08 + rnd.next() * 0.82), iy + ih * rnd.pick([0.30, 0.46]), iw * 0.05, ih * 0.09);
          }

          // the counter and its warm underside
          ctx.fillStyle = 'rgba(58,34,18,.62)';
          ctx.fillRect(ix, iy + ih * 0.66, iw, ih * 0.20);
          ctx.fillStyle = 'rgba(255,226,178,.22)';
          ctx.fillRect(ix, iy + ih * 0.64, iw, 4);

          // a plant or a stack of crates near one edge, for asymmetry
          if (rnd.chance(0.5)) {
            ctx.fillStyle = 'rgba(46,86,58,.75)';
            ctx.beginPath();
            ctx.ellipse(ix + iw * 0.16, iy + ih * 0.56, iw * 0.07, ih * 0.09, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // --- mullions: the glass is held in a frame, not painted on the wall
        ctx.fillStyle = '#0e1116';
        const bars = rnd.int(1, 2);
        ctx.fillRect(ix, iy, 5, ih);
        ctx.fillRect(ix + iw - 5, iy, 5, ih);
        for (let b = 1; b <= bars; b++) {
          ctx.fillRect(ix + (iw * b) / (bars + 1) - 2, iy, 4, ih);
        }
        // sill
        ctx.fillStyle = '#252b33';
        ctx.fillRect(x + 4, y + H - 11, W - 8, 8);
        // a soft sheen across the glass
        const sheen = ctx.createLinearGradient(ix, iy, ix + iw, iy + ih);
        sheen.addColorStop(0, 'rgba(255,255,255,.14)');
        sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
        sheen.addColorStop(1, 'rgba(255,255,255,.06)');
        ctx.fillStyle = sheen;
        ctx.fillRect(ix, iy, iw, ih);
      }
    }
  });

  const t = toTexture(c, { repeat: 1 });
  cache.set(key, t);
  return t;
}

// Name boards. One atlas holds every shop name in the city, so all of them are one batch.
const SIGN_COLS = 4, SIGN_ROWS = 4, SIGN_W = 256, SIGN_H = 104;
export const SIGN_ATLAS = { cols: SIGN_COLS, rows: SIGN_ROWS };

const SIGN_NAMES = [
  ['喫茶', '落日'], ['書房', '風待ち'], ['ラーメン', '汐'], ['花屋', '澪'],
  ['珈琲', '月'], ['雑貨', '灯'], ['薬局', '蒼'], ['焼鳥', '炎'],
  ['八百屋', '緑'], ['古着', '葉'], ['写真', '光'], ['酒場', '藍'],
  ['文具', '空'], ['茶屋', '雪'], ['面包', '麦'], ['時計', '音']
];

export function signAtlas() {
  const key = 'sign-atlas';
  if (cache.has(key)) return cache.get(key);
  const rnd = makeRandom(9203);
  const S = SIGN_W * SIGN_COLS;
  const H = SIGN_H * SIGN_ROWS;

  const c = document.createElement('canvas');
  c.width = S; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, H);

  for (let row = 0; row < SIGN_ROWS; row++) {
    for (let col = 0; col < SIGN_COLS; col++) {
      const [main, sub] = SIGN_NAMES[row * SIGN_COLS + col];
      const x = col * SIGN_W, y = row * SIGN_H;
      const hue = rnd.pick([22, 34, 44, 190, 205, 340, 8, 96]);
      const deep = `hsl(${hue}, 46%, 13%)`;

      // board
      ctx.fillStyle = deep;
      ctx.fillRect(x, y, SIGN_W, SIGN_H);
      // neon rule
      ctx.strokeStyle = `hsl(${hue}, 92%, 68%)`;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 5, y + 5, SIGN_W - 10, SIGN_H - 10);

      // name
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = `hsl(${hue}, 95%, 72%)`;
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#fff6ea';
      ctx.font = '700 46px "Microsoft YaHei", "Noto Sans SC", sans-serif';
      ctx.fillText(main, x + SIGN_W / 2, y + SIGN_H * 0.44);
      ctx.shadowBlur = 8;
      ctx.fillStyle = `hsl(${hue}, 88%, 76%)`;
      ctx.font = '500 22px "Microsoft YaHei", "Noto Sans SC", sans-serif';
      ctx.fillText(sub, x + SIGN_W / 2, y + SIGN_H * 0.79);
      ctx.restore();
    }
  }

  const t = toTexture(c, { repeat: 1 });
  cache.set(key, t);
  return t;
}

// Vertical neon signs bolted to the tower faces — the single most "city at night" prop
// there is, and one batch for all of them.
export const NEON_CELLS = 4;

export function neonAtlas() {
  const key = 'neon-atlas';
  if (cache.has(key)) return cache.get(key);
  const CW = 128, CH = 512;
  const c = document.createElement('canvas');
  c.width = CW * NEON_CELLS; c.height = CH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);

  const words = ['喫茶', '夜光', '酒処', '書林'];

  for (let i = 0; i < NEON_CELLS; i++) {
    const x = i * CW;
    const hue = [22, 196, 340, 46][i];
    ctx.fillStyle = `hsl(${hue}, 42%, 10%)`;
    ctx.fillRect(x + 6, 8, CW - 12, CH - 16);
    ctx.strokeStyle = `hsl(${hue}, 90%, 66%)`;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 10, 12, CW - 20, CH - 24);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = `hsl(${hue}, 96%, 70%)`;
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#fff8f0';
    ctx.font = '700 74px "Microsoft YaHei", "Noto Sans SC", sans-serif';
    const chars = words[i].split('');
    chars.forEach((ch, k) => {
      ctx.fillText(ch, x + CW / 2, 120 + k * 132);
    });
    ctx.shadowBlur = 0;
  }

  const t = toTexture(c, { repeat: 1 });
  cache.set(key, t);
  return t;
}

// Vending machine fronts: 8 cells of 128 x 256. At night these are the brightest small
// lights in the street, which is exactly how a Japanese city looks after dark.
export const VENDING_CELLS = 8;

export function vendingAtlas() {
  const key = 'vending-atlas';
  if (cache.has(key)) return cache.get(key);
  const CW = 128, CH = 256, COLS = 4;
  const c = document.createElement('canvas');
  c.width = CW * COLS; c.height = CH * 2;
  const ctx = c.getContext('2d');
  const rnd = makeRandom(3377);

  for (let i = 0; i < VENDING_CELLS; i++) {
    const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
    const brand = rnd.pick(['#b8242a', '#1d4f9c', '#0f7a4a', '#d1c9bd']);
    ctx.fillStyle = brand;
    ctx.fillRect(x, y, CW, CH);
    // display window full of drink cans
    ctx.fillStyle = '#f7fbff';
    ctx.fillRect(x + 8, y + 10, CW - 16, CH * 0.56);
    for (let r = 0; r < 5; r++) {
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = `hsl(${Math.round(rnd.range(0, 360))}, 78%, 58%)`;
        ctx.fillRect(x + 13 + k * 21, y + 18 + r * 27, 16, 22);
      }
    }
    // the coin slot / buttons strip and the delivery flap
    ctx.fillStyle = 'rgba(20,24,30,.85)';
    ctx.fillRect(x + 10, y + CH * 0.62, CW - 20, CH * 0.10);
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fillRect(x + 10, y + CH * 0.76, CW - 20, CH * 0.18);
    ctx.fillStyle = 'rgba(10,12,16,.7)';
    ctx.fillRect(x + 18, y + CH * 0.80, CW - 36, CH * 0.08);
  }

  const t = toTexture(c, { repeat: 1 });
  cache.set(key, t);
  return t;
}

export function disposeTextures() {
  for (const v of cache.values()) {
    if (v && v.isTexture) v.dispose();
    else if (v) for (const t of [v.map, v.emissiveMap, v.bumpMap, v.roughnessMap]) t?.dispose?.();
  }
  cache.clear();
}