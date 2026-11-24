// Time dial: [ and ] pressed together turn the clock into something you can spin.
//
// Twenty-minute nudges are fine for judging a shadow and useless for saying "make it
// 19:40". The dial is a 24-hour ring: drag anywhere on it (or click a preset) and the sky
// follows immediately — the caller only has to write one number, `s.minute`, and the next
// frame rebuilds the atmosphere from it.

const SIZE = 300;                 // CSS px of the dial
const R = 116;                    // ring radius
const SNAP = 5;                   // minutes per step, so a steady hand can still hit 19:40

const PRESETS = [
  { label: '黎明', minute: 6 * 60 + 10 },
  { label: '上午', minute: 9 * 60 + 20 },
  { label: '正午', minute: 12 * 60 + 30 },
  { label: '黄昏', minute: 18 * 60 + 20 },
  { label: '入夜', minute: 20 * 60 + 30 },
  { label: '深夜', minute: 23 * 60 + 40 }
];

const TAU = Math.PI * 2;

/**
 * @param {object} opts
 * @param {() => number} opts.getMinute   reads the live clock
 * @param {() => string} opts.getPhase    reads the live phase label ("黄昏")
 * @param {(m: number) => string} opts.labelOf  formats a minute as "18:20"
 * @param {(m: number) => void} opts.onSet     writes the clock (caller updates the sky)
 */
export function createTimeDial({ getMinute, getPhase, labelOf, onSet }) {
  const root = document.createElement('div');
  root.id = 'dial';
  root.className = 'dial';

  const card = document.createElement('div');
  card.className = 'dial-card';

  const head = document.createElement('div');
  head.className = 'dial-head';
  head.innerHTML = '<b>时间</b><span>拖动指针设定 · 滚轮微调 · <kbd>Esc</kbd> 关闭</span>';

  const read = document.createElement('div');
  read.className = 'dial-read';
  const clockEl = document.createElement('b');
  const phaseEl = document.createElement('span');
  read.append(clockEl, phaseEl);

  const wrap = document.createElement('div');
  wrap.className = 'dial-wrap';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);

  const chips = document.createElement('div');
  chips.className = 'dial-chips';

  card.append(head, read, wrap, chips);
  root.appendChild(card);
  document.body.appendChild(root);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width = SIZE + 'px';
  canvas.style.height = SIZE + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = SIZE / 2;
  const cy = SIZE / 2;

  let open = false;
  let minute = getMinute();
  let dragging = false;

  const angleOf = m => (m / 1440) * TAU;           // 0 at midnight, clockwise
  const point = (a, r) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];

  function drawRing() {
    ctx.clearRect(0, 0, SIZE, SIZE);

    // --- the two halves of the day, so the ring itself says which end is night
    const night = 'rgba(96, 128, 196, 0.14)';
    const day = 'rgba(255, 214, 160, 0.16)';
    ctx.lineWidth = 16;
    for (const [from, to, colour] of [[360, 1140, day], [1140, 1800, night], [0, 360, night]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, angleOf(from) - Math.PI / 2, angleOf(to) - Math.PI / 2);
      ctx.strokeStyle = colour;
      ctx.stroke();
    }

    // --- ring + hour ticks; every six hours gets a number
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.strokeStyle = 'rgba(196, 214, 244, 0.26)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    for (let h = 0; h < 24; h++) {
      const a = angleOf(h * 60);
      const big = h % 6 === 0;
      const [x0, y0] = point(a, R - (big ? 12 : 7));
      const [x1, y1] = point(a, R - 1);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = big ? 'rgba(232, 240, 255, 0.75)' : 'rgba(196, 214, 244, 0.30)';
      ctx.lineWidth = big ? 2 : 1;
      ctx.stroke();

      if (big) {
        const [lx, ly] = point(a, R + 17);
        ctx.font = '600 12px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(232, 240, 255, 0.72)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(h), lx, ly);
      }
    }
  }

  function draw() {
    drawRing();

    // --- the hand
    const a = angleOf(minute);
    const [hx, hy] = point(a, R - 26);
    const [kx, ky] = point(a, R - 4);
    const grad = ctx.createLinearGradient(cx, cy, kx, ky);
    grad.addColorStop(0, 'rgba(255, 226, 186, 0.25)');
    grad.addColorStop(1, 'rgba(255, 226, 186, 0.95)');
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(kx, ky, 9, 0, TAU);
    ctx.fillStyle = 'rgba(255, 226, 186, 0.95)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(kx, ky, 13, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 226, 186, 0.35)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, TAU);
    ctx.fillStyle = 'rgba(232, 240, 255, 0.55)';
    ctx.fill();

    clockEl.textContent = labelOf(minute);
    phaseEl.textContent = getPhase();
    markChips();
  }

  function write(m) {
    minute = ((Math.round(m / SNAP) * SNAP) % 1440 + 1440) % 1440;
    onSet(minute);
    draw();
  }

  function fromEvent(ev) {
    const r = canvas.getBoundingClientRect();
    const dx = ev.clientX - r.left - cx;
    const dy = ev.clientY - r.top - cy;
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += TAU;
    write((a / TAU) * 1440);
  }

  canvas.addEventListener('pointerdown', ev => {
    dragging = true;
    canvas.setPointerCapture?.(ev.pointerId);
    fromEvent(ev);
  });
  canvas.addEventListener('pointermove', ev => {
    if (dragging) fromEvent(ev);
  });
  const endDrag = ev => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture?.(ev.pointerId); } catch { /* already gone */ }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    write(minute + Math.sign(ev.deltaY) * 10);
  }, { passive: false });

  const chipEls = PRESETS.map(preset => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dial-chip';
    b.textContent = preset.label;
    b.addEventListener('click', () => write(preset.minute));
    chips.appendChild(b);
    return { el: b, preset };
  });

  // Which chip matches the clock right now: the nearest preset within three quarters of an
  // hour, so the row shows where you are instead of looking like six dead buttons.
  function markChips() {
    for (const { el, preset } of chipEls) {
      let d = Math.abs(minute - preset.minute);
      d = Math.min(d, 1440 - d);
      el.classList.toggle('on', d <= 45);
    }
  }

  // Clicking the dimmed area around the card closes the dial.
  root.addEventListener('pointerdown', ev => {
    if (ev.target === root) close();
  });

  function openPanel() {
    if (open) return;
    open = true;
    minute = ((getMinute() % 1440) + 1440) % 1440;
    draw();
    root.classList.add('on');
  }

  function close() {
    if (!open) return;
    open = false;
    dragging = false;
    root.classList.remove('on');
  }

  return {
    element: root,
    open: openPanel,
    close,
    toggle() { open ? close() : openPanel(); },
    get isOpen() { return open; },
    get minute() { return minute; },
    redraw() { if (open) draw(); }
  };
}