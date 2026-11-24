// Keyboard + pointer state for a third-person walker.
//
// Two ways to look around, whichever the browser gives us:
//
// * **pointer lock** — the normal one. Click the canvas and the pointer disappears and is
//   captured; every mouse movement turns the camera directly, no button held. Escape is
//   the browser's own "release the pointer", so the same key that closes a menu also
//   hands the cursor back, and `onLock` reports it so the game can pause.
// * **drag** — the fallback, for a page that cannot get the lock (an iframe without
//   allow-pointer-lock, or an automated browser that refuses the request). Holding the
//   left button and dragging orbits the camera exactly as before.
//
// Look deltas are accumulated and consumed once per frame, so a burst of pointermove
// events between two frames cannot outrun the camera.

// Locked deltas arrive as raw device-ish pixels; a factor under 1 keeps the same feel as
// the drag path without the 1.6x-wider travel of a real mouse.
const LOCK_SENS = 0.62;

export function createInput(canvas) {
  const down = new Set();
  const state = {
    forward: 0, right: 0, run: false,
    lookX: 0, lookY: 0, zoom: 0,
    // One-shot presses, drained by the frame that reads them.
    pressed: new Set()
  };
  const lockListeners = new Set();
  let locked = false;

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

  // ---- pointer lock
  const onLockChange = () => {
    const now = document.pointerLockElement === canvas;
    if (now === locked) return;
    locked = now;
    dragging = false;
    pid = -1;
    canvas.style.cursor = '';
    for (const fn of lockListeners) fn(locked);
  };
  const onLockError = () => {
    // A refused request is *not* the same thing as losing the lock: we never had it, so
    // nothing must react as if the player paused. Drag-to-look still covers this case.
    locked = false;
  };
  const onMouseMove = e => {
    if (!locked) return;
    // Moving the mouse right (movementX > 0) must swing the view right, so the horizontal
    // delta is subtracted: `yaw` grows counter-clockwise from above, and yaw += x turned
    // the camera the wrong way (left input, right turn). Vertical stays as-is: mouse down
    // looks down.
    state.lookX -= (e.movementX || 0) * LOCK_SENS;
    state.lookY += (e.movementY || 0) * LOCK_SENS;
  };

  // ---- pointer orbit (fallback when the lock is unavailable)
  let dragging = false, lastX = 0, lastY = 0, pid = -1;

  const onPointerDown = e => {
    if (locked) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true;
    pid = e.pointerId;
    lastX = e.clientX; lastY = e.clientY;
    // A pointer can already be gone by the time we get here (a fast tap, or a synthetic
    // event from automation) and then setPointerCapture throws. Losing the capture only
    // costs us the drag continuing outside the canvas, so swallow it instead of letting
    // an exception escape the handler.
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
    canvas.style.cursor = 'grabbing';
  };
  const onPointerMove = e => {
    if (locked || !dragging || e.pointerId !== pid) return;
    // Same mapping as the locked path, so switching between the two never flips the feel.
    state.lookX -= e.clientX - lastX;
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
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  document.addEventListener('mousemove', onMouseMove);
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

    /** Ask the browser to capture the pointer. Safe to call when already locked. */
    requestLock() {
      if (locked) return;
      try {
        const p = canvas.requestPointerLock?.();
        // Chrome returns a promise here and rejects it when it wants a fresher gesture.
        if (p && typeof p.catch === 'function') p.catch(() => onLockError());
      } catch { onLockError(); }
    },
    /** Hand the cursor back. The browser also does this itself on Escape. */
    exitLock() {
      if (locked) document.exitPointerLock?.();
    },
    /** Fires with true/false whenever the lock is taken, released or refused. */
    onLock(fn) { lockListeners.add(fn); return () => lockListeners.delete(fn); },
    get locked() { return locked; },
    get dragging() { return dragging; },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('wheel', onWheel);
    }
  };
}