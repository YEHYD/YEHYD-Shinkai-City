// Keyboard + pointer state for a third-person walker.
//
// Mouse/touch drag orbits the camera (the pointer is captured, not lock-stepped, so the
// page stays usable without a permission prompt). Wheel zooms. The look deltas are
// accumulated and consumed once per frame so a burst of pointermove events between two
// frames cannot outrun the camera.

export function createInput(canvas) {
  const down = new Set();
  const state = {
    forward: 0, right: 0, run: false,
    lookX: 0, lookY: 0, zoom: 0,
    // One-shot presses, drained by the frame that reads them.
    pressed: new Set()
  };

  const CODE_MAP = {
    KeyW: 'forward+', ArrowUp: 'forward+',
    KeyS: 'forward-', ArrowDown: 'forward-',
    KeyA: 'right-', ArrowLeft: 'right-',
    KeyD: 'right+', ArrowRight: 'right+',
    ShiftLeft: 'run', ShiftRight: 'run'
  };

  const onKeyDown = e => {
    if (e.repeat) return;
    const m = CODE_MAP[e.code];
    if (m) {
      down.add(m);
      e.preventDefault();
    }
    if (['BracketLeft', 'BracketRight', 'KeyE', 'KeyR', 'KeyF', 'KeyV', 'KeyM',
         'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Escape', 'Space'].includes(e.code)) {
      state.pressed.add(e.code);
      e.preventDefault();
    }
  };
  const onKeyUp = e => {
    const m = CODE_MAP[e.code];
    if (m) down.delete(m);
  };
  const onBlur = () => down.clear();

  // ---- pointer orbit
  let dragging = false, lastX = 0, lastY = 0, pid = -1;

  const onPointerDown = e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true;
    pid = e.pointerId;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const onPointerMove = e => {
    if (!dragging || e.pointerId !== pid) return;
    state.lookX += e.clientX - lastX;
    state.lookY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  };
  const endDrag = e => {
    if (e && e.pointerId !== pid) return;
    dragging = false;
    pid = -1;
    canvas.style.cursor = '';
  };
  const onWheel = e => {
    e.preventDefault();
    state.zoom += Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 100 + 0.25);
  };

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  return {
    /** Read movement axes and clear the one-shot state. Call once per frame. */
    sample() {
      state.forward = (down.has('forward+') ? 1 : 0) - (down.has('forward-') ? 1 : 0);
      state.right = (down.has('right+') ? 1 : 0) - (down.has('right-') ? 1 : 0);
      state.run = down.has('run');
      return state;
    },
    consumeLook() {
      const out = { x: state.lookX, y: state.lookY, zoom: state.zoom };
      state.lookX = 0; state.lookY = 0; state.zoom = 0;
      return out;
    },
    takePressed(code) {
      if (!state.pressed.has(code)) return false;
      state.pressed.delete(code);
      return true;
    },
    get dragging() { return dragging; },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', onWheel);
    }
  };
}