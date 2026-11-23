// One rAF loop for the whole app: fixed-cap delta so a stalled tab cannot teleport the
// camera through a building, plus a smoothed fps meter for the HUD.

export function createLoop(onFrame) {
  let raf = 0;
  let last = 0;
  let running = false;
  let fps = 60;
  let time = 0;

  const tick = now => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    // Cap at 1/20s: a long stall becomes one short frame instead of a jump.
    const dt = Math.min(raw, 0.05);
    time += dt;
    if (raw > 0) fps += (1 / raw - fps) * 0.06;
    onFrame(dt, time);
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get fps() { return fps; },
    get time() { return time; }
  };
}