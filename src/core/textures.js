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

// ---------------------------------------------------------------- building facades
// A facade tile holds `COLS x ROWS` window bays. It comes as a matched pair: the albedo
// (wall + glass) and the emissive (only the lit windows), drawn from the same seed so
// the glow lands exactly on the glass.

const COLS = 6, ROWS = 6, TILE = 256;

function facadePair(seed) {
  const rnd = makeRandom(seed);
  const wall = rnd.pick(['#5b6472', '#6b6560', '#59616e', '#6f6a70', '#565d69', '#77726c']);
  const glass = '#232c3a';
  const lit = [];   // [x, y, w, h, colour]
  const bays = [];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Window bay geometry inside a cell of the tile.
      const cw = TILE / COLS, ch = TILE / ROWS;
      const x = c * cw + cw * 0.16;
      const y = r * ch + ch * 0.20;
      const w = cw * 0.68;
      const h = ch * 0.54;
      const isLit = rnd.chance(0.42);
      bays.push([x, y, w, h, isLit]);
      if (isLit) {
        const tint = rnd.pick(['#ffe4b0', '#fff2d2', '#ffd08a', '#dce7ff', '#bfe2ff', '#ffc98a']);
        lit.push([x, y, w, h, tint, rnd.range(0.55, 1)]);
      }
    }
  }

  const albedo = canvas(TILE, (ctx, S) => {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, S, S);
    // faint vertical mullions + floor slabs
    ctx.fillStyle = 'rgba(0,0,0,.10)';
    for (let c = 0; c <= COLS; c++) ctx.fillRect(Math.round(c * S / COLS) - 1, 0, 2, S);
    for (let r = 0; r <= ROWS; r++) ctx.fillRect(0, Math.round(r * S / ROWS) - 1, S, 2);
    for (const [x, y, w, h, isLit] of bays) {
      ctx.fillStyle = isLit ? 'rgba(255,240,210,.82)' : glass;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,.34)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
    }
    // grime gradient so the tile does not read as flat
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(255,255,255,.07)');
    g.addColorStop(.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.16)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  });

  const emissive = canvas(TILE, (ctx, S) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    for (const [x, y, w, h, tint, a] of lit) {
      ctx.globalAlpha = a;
      ctx.fillStyle = tint;
      ctx.fillRect(x, y, w, h);
    }
    ctx.globalAlpha = 1;
  });

  return { albedo, emissive };
}

/** @returns {{map: THREE.Texture, emissiveMap: THREE.Texture}} */
export function facadeTextures(variant = 0) {
  const key = `facade${variant}`;
  if (cache.has(key)) return cache.get(key);
  const pair = facadePair(9001 + variant * 7919);
  const out = {
    map: toTexture(pair.albedo, { repeat: 1 }),
    emissiveMap: toTexture(pair.emissive, { repeat: 1 })
  };
  cache.set(key, out);
  return out;
}

export const FACADE_VARIANTS = 4;

// ---------------------------------------------------------------- ground
// One tile == one city cell, measured corner to corner between two road centre lines:
//   |<-6m road->|<-3m walk->|<-30m block->|<-3m walk->|<-6m road->|
// Roads sit on the tile's edges, so the tile repeats seamlessly across the grid.

export const GROUND_TILE_METERS = 48;

export function groundTexture() {
  const key = 'ground';
  if (cache.has(key)) return cache.get(key);

  const S = 1024;
  const px = S / GROUND_TILE_METERS;          // pixels per metre
  const rnd = makeRandom(4242);

  const c = canvas(S, (ctx) => {
    // asphalt everywhere first
    ctx.fillStyle = '#23272f';
    ctx.fillRect(0, 0, S, S);

    const road = 6 * px, walk = 3 * px, block = 30 * px;

    // block slab: pavement + the buildable lot
    for (const [ox, oy] of [[0, 0]]) {
      ctx.fillStyle = '#7d828c';
      ctx.fillRect(road, road, S - road * 2, S - road * 2);
    }
    // pavement tone variation
    for (let i = 0; i < 2600; i++) {
      const x = rnd.range(road, S - road), y = rnd.range(road, S - road);
      ctx.fillStyle = `rgba(${rnd.int(90, 150)},${rnd.int(94, 152)},${rnd.int(100, 160)},${rnd.range(.03, .10)})`;
      ctx.fillRect(x, y, rnd.range(3, 16), rnd.range(3, 16));
    }

    // curb ring
    ctx.strokeStyle = '#5d626b';
    ctx.lineWidth = px * 0.5;
    ctx.strokeRect(road, road, S - road * 2, S - road * 2);

    // inner lot paving (buildings stand here)
    ctx.fillStyle = '#6a6f79';
    ctx.fillRect(road + walk, road + walk, block + walk * 0, S - (road + walk) * 2);

    // lot seams
    ctx.strokeStyle = 'rgba(40,44,52,.55)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      const p = road + walk + (S - (road + walk) * 2) * i / 5;
      ctx.beginPath(); ctx.moveTo(p, road + walk); ctx.lineTo(p, S - road - walk); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(road + walk, p); ctx.lineTo(S - road - walk, p); ctx.stroke();
    }

    // asphalt speckle
    for (let i = 0; i < 5200; i++) {
      const onEdgeX = rnd.chance(0.5);
      const x = onEdgeX ? (rnd.chance(.5) ? rnd.range(0, road) : rnd.range(S - road, S)) : rnd.range(0, S);
      const y = onEdgeX ? rnd.range(0, S) : (rnd.chance(.5) ? rnd.range(0, road) : rnd.range(S - road, S));
      const v = rnd.int(28, 66);
      ctx.fillStyle = `rgba(${v},${v + 3},${v + 8},${rnd.range(.15, .5)})`;
      ctx.fillRect(x, y, rnd.range(1, 4), rnd.range(1, 4));
    }

    // ---- lane markings: centre line runs along each edge, lane edges 5m inside
    ctx.fillStyle = 'rgba(226,220,196,.72)';
    const dash = px * 3, gap = px * 3;
    const drawDashed = (vertical, at) => {
      for (let p = 0; p < S; p += dash + gap) {
        if (vertical) ctx.fillRect(at - px * 0.1, p, px * 0.2, dash);
        else ctx.fillRect(p, at - px * 0.1, dash, px * 0.2);
      }
    };
    // The centre double line sits on the tile border; draw both halves so it survives tiling.
    ctx.fillStyle = 'rgba(230,226,200,.55)';
    drawDashed(true, 0); drawDashed(true, S);
    drawDashed(false, 0); drawDashed(false, S);

    // solid lane edges at +/-5m from the centre line
    ctx.fillStyle = 'rgba(224,222,206,.30)';
    for (const at of [px * 5, S - px * 5]) {
      ctx.fillRect(at - 1, 0, 2, S);
      ctx.fillRect(0, at - 1, S, 2);
    }

    // crosswalk stripes at each corner, inside the road margins
    ctx.fillStyle = 'rgba(232,230,214,.5)';
    for (const [zx, zy] of [[0, 0], [S, 0], [0, S], [S, S]]) {
      for (let i = 0; i < 5; i++) {
        const off = (i - 2) * px * 1.1;
        ctx.fillRect(zx - px * 1.2, clampEdge(zy + off, S), px * 2.4, px * 0.55);
        ctx.fillRect(clampEdge(zx + off, S), zy - px * 1.2, px * 0.55, px * 2.4);
      }
    }

    function clampEdge(v, max) { return Math.max(0, Math.min(max - px * 0.55, v)); }
  });

  const t = toTexture(c, { repeat: 1 });
  cache.set(key, t);
  return t;
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
    else if (v && v.map) { v.map.dispose(); v.emissiveMap.dispose(); }
  }
  cache.clear();
}