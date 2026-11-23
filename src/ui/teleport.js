// Teleport map: a top-down plan of the city you can click.
//
// The plan is drawn once from the generated layout (roads, blocks, plazas) into an
// offscreen canvas, then every time the panel opens it is copied and the pins are
// stamped on top. Clicking a pin jumps to that character; clicking anywhere else jumps
// to that spot if the caller can find a safe place to stand there.

import { CELL, HALF, CITY_SIZE, ROAD_HALF } from '../world/layout.js';

const SIZE = 560;                 // CSS px of the plan
const PIN_HIT = 15;               // CSS px

export function createTeleportPanel({ layout, npcs, onPick, getPlayer }) {
  const root = document.createElement('div');
  root.id = 'map';
  root.className = 'map';

  const card = document.createElement('div');
  card.className = 'map-card';

  const head = document.createElement('div');
  head.className = 'map-head';
  head.innerHTML = '<b>城市地图</b><span>点击任意位置传送 · 点角色直接过去 · <kbd>M</kbd> / <kbd>Esc</kbd> 关闭</span>';

  const wrap = document.createElement('div');
  wrap.className = 'map-canvas';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);

  const chips = document.createElement('div');
  chips.className = 'map-chips';

  card.append(head, wrap, chips);
  root.appendChild(card);
  document.body.appendChild(root);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width = SIZE + 'px';
  canvas.style.height = SIZE + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // ------------------------------------------------------------- the static plan
  const base = document.createElement('canvas');
  base.width = SIZE * dpr;
  base.height = SIZE * dpr;
  const bx = base.getContext('2d');
  bx.scale(dpr, dpr);

  const scale = SIZE / CITY_SIZE;
  const toPx = v => (v + HALF) * scale;

  (function drawBase() {
    bx.fillStyle = '#0b0f16';
    bx.fillRect(0, 0, SIZE, SIZE);

    // plazas
    bx.fillStyle = 'rgba(96,132,96,0.30)';
    for (const p of layout.plazas || []) {
      bx.fillRect(toPx(p.x - p.w / 2), toPx(p.z - p.d / 2), p.w * scale, p.d * scale);
    }

    // the grid, drawn as asphalt strips
    const lines = [];
    for (let k = 0; k <= Math.round((HALF * 2) / CELL); k++) lines.push(-HALF + CELL * k);
    bx.fillStyle = 'rgba(150,168,196,0.20)';
    for (const l of lines) {
      bx.fillRect(0, toPx(l) - ROAD_HALF * scale, SIZE, ROAD_HALF * 2 * scale);
      bx.fillRect(toPx(l) - ROAD_HALF * scale, 0, ROAD_HALF * 2 * scale, SIZE);
    }
    // centre lines
    bx.strokeStyle = 'rgba(210,224,255,0.16)';
    bx.lineWidth = 1;
    for (const l of lines) {
      bx.beginPath();
      bx.moveTo(0, toPx(l)); bx.lineTo(SIZE, toPx(l));
      bx.moveTo(toPx(l), 0); bx.lineTo(toPx(l), SIZE);
      bx.stroke();
    }

    // buildings: taller ones read lighter, so the skyline shows up in the plan
    for (const b of layout.buildings) {
      const t = Math.min(1, (b.h || 20) / 130);
      bx.fillStyle = `rgba(${86 + t * 96},${96 + t * 104},${122 + t * 96},0.62)`;
      bx.fillRect(toPx(b.x - b.w / 2), toPx(b.z - b.d / 2), b.w * scale, b.d * scale);
    }

    // frame
    bx.strokeStyle = 'rgba(255,231,196,0.22)';
    bx.lineWidth = 1;
    bx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
  })();

  // ------------------------------------------------------------- pins
  const pins = [];
  function addPin(x, z, label, accent) {
    pins.push({ x, z, label, accent });
  }

  let open = false;

  function draw() {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(base, 0, 0, SIZE, SIZE);

    // named characters
    const fl = 8;
    for (const n of npcs) {
      const px = toPx(n.x), pz = toPx(n.z);
      ctx.beginPath();
      ctx.arc(px, pz, 5.4, 0, Math.PI * 2);
      ctx.fillStyle = n.accent || '#ffe3b8';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, pz, 9.5, 0, Math.PI * 2);
      ctx.strokeStyle = (n.accent || '#ffe3b8') + '99';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (fl) {
        ctx.font = '600 11px "Microsoft YaHei", "Noto Sans SC", sans-serif';
        ctx.fillStyle = 'rgba(255,244,228,0.92)';
        ctx.fillText(n.name, px + 12, pz + 4);
      }
    }

    // the player
    const p = getPlayer();
    const px = toPx(p.x), pz = toPx(p.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-(p.facing || 0));
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.4, 6);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-5.4, 6);
    ctx.closePath();
    ctx.fillStyle = '#7fd7ff';
    ctx.fill();
    ctx.restore();
  }

  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const cx = clientX - r.left;
    const cy = clientY - r.top;
    let best = null, bestD = PIN_HIT * PIN_HIT;
    for (const n of npcs) {
      const dx = toPx(n.x) - cx, dz = toPx(n.z) - cy;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = n; }
    }
    if (best) return { npcId: best.id, x: best.x, z: best.z };
    const wx = cx / scale - HALF;
    const wz = cy / scale - HALF;
    return { npcId: null, x: wx, z: wz };
  }

  canvas.addEventListener('click', ev => {
    const hit = pickAt(ev.clientX, ev.clientY);
    if (!hit.npcId && (Math.abs(hit.x) > HALF - 8 || Math.abs(hit.z) > HALF - 8)) return;
    onPick(hit);
    close();
  });

  // chips: one per character, so the map also works from the keyboard
  for (const n of npcs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-chip';
    b.textContent = n.name;
    b.style.setProperty('--dot', n.accent || '#ffe3b8');
    b.addEventListener('click', () => {
      onPick({ npcId: n.id, x: n.x, z: n.z });
      close();
    });
    chips.appendChild(b);
  }
  const home = document.createElement('button');
  home.type = 'button';
  home.className = 'map-chip';
  home.textContent = '中心路口';
  home.style.setProperty('--dot', '#7fd7ff');
  home.addEventListener('click', () => {
    onPick({ npcId: null, x: 0, z: 0 });
    close();
  });
  chips.prepend(home);

  function openPanel() {
    if (open) return;
    open = true;
    draw();
    root.classList.add('on');
  }

  function close() {
    open = false;
    root.classList.remove('on');
  }

  return {
    element: root,
    open: openPanel,
    close,
    toggle() { open ? close() : openPanel(); },
    get isOpen() { return open; },
    redraw() { if (open) draw(); }
  };
}