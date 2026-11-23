// Third person camera rig.
//
// The camera orbits a point just above the player's shoulders. Pointer drag turns it,
// the wheel pulls it in and out, and a segment test against the building boxes pulls it
// in whenever a wall would otherwise come between the camera and the player.

import * as THREE from 'three';
import { clamp, damp } from '../core/random.js';

const PITCH_MIN = -0.30;
const PITCH_MAX = 1.05;
const DIST_MIN = 2.4;
const DIST_MAX = 9.5;
const HEIGHT = 1.62;
// radians of orbit per pixel of drag
const LOOK_SENS = 0.0034;

// Aerial rig: the same orbit, lifted far above the street. The pitch and the distance
// are kept apart from the follow values so switching modes glides instead of snapping.
const AERIAL_PITCH_MIN = 0.26;
const AERIAL_PITCH_MAX = 1.34;
const AERIAL_DIST_MIN = 45;
const AERIAL_DIST_MAX = 420;

/** Segment vs AABB (slab method). Returns the entry t in 0..1, or 1 when clear. */
function hitBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = 1;
  const mins = [b.minX, 0, b.minZ];
  const maxs = [b.maxX, b.h ?? 40, b.maxZ];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-6) {
      if (o[i] < mins[i] || o[i] > maxs[i]) return 1;
    } else {
      let t1 = (mins[i] - o[i]) / d[i];
      let t2 = (maxs[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return 1;
    }
  }
  return tmin > 0.02 ? tmin : 1;
}

export function createThirdPerson(camera, input, boxes) {
  let yaw = Math.PI;
  let pitch = 0.20;
  let dist = 5.4;
  let wantDist = 5.4;

  let mode = 'follow';
  let aPitch = 0.42;
  let aDist = 235;

  // Smoothed values actually used for the transform.
  let sYaw = yaw;
  let sPitch = pitch;
  let sDist = dist;

  const target = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const desired = new THREE.Vector3();

  let initialised = false;

  // Optional (x, z) -> roof height lookup, installed by the caller once the city exists.
  // The crane shot uses it to stay above the skyline it is flying over.
  let roofLookup = null;

  return {
    get yaw() { return sYaw; },
    get pitch() { return sPitch; },
    get distance() { return sDist; },
    get aerial() { return mode === 'aerial'; },

    /**
     * @param {number} dt
     * @param {{x:number,z:number}} focus player position
     */
    update(dt, focus) {
      const aerial = mode === 'aerial';

      // --- pointer / wheel input
      const look = input.consumeLook();
      yaw += look.x * LOOK_SENS;
      if (aerial) {
        aPitch = clamp(aPitch + look.y * LOOK_SENS, AERIAL_PITCH_MIN, AERIAL_PITCH_MAX);
        if (look.zoom) aDist = clamp(aDist * (1 + look.zoom * 0.055), AERIAL_DIST_MIN, AERIAL_DIST_MAX);
      } else {
        pitch = clamp(pitch + look.y * LOOK_SENS, PITCH_MIN, PITCH_MAX);
        if (look.zoom) {
          wantDist = clamp(wantDist + look.zoom * wantDist * 0.055, DIST_MIN, DIST_MAX);
        }
      }

      sYaw = damp(sYaw, yaw, 26, dt);

      if (aerial) {
        // -------------------------------------------------- crane shot over the city
        sPitch = damp(sPitch, aPitch, 5, dt);
        sDist = damp(sDist, aDist, 4.5, dt);

        target.set(focus.x, 0, focus.z);
        const cp = Math.cos(sPitch);
        const dirX = Math.sin(sYaw) * cp;
        const dirY = Math.sin(sPitch);
        const dirZ = Math.cos(sYaw) * cp;

        desired.set(target.x + dirX * sDist, target.y + dirY * sDist, target.z + dirZ * sDist);
        if (desired.y < 12) desired.y = 12;
        // A crane 200 m back and 150 m up puts the lens inside a tower as often as not,
        // and the frame fills with the inside of a wall. Lift it over the local roof.
        if (roofLookup) {
          const roof = roofLookup(desired.x, desired.z);
          if (desired.y < roof + 9) desired.y = roof + 9;
        }

        if (!initialised) {
          camPos.copy(desired);
          initialised = true;
        } else {
          camPos.x = damp(camPos.x, desired.x, 9, dt);
          camPos.y = damp(camPos.y, desired.y, 9, dt);
          camPos.z = damp(camPos.z, desired.z, 9, dt);
        }

        camera.position.copy(camPos);
        camera.lookAt(target.x, 4, target.z);
        return;
      }

      sPitch = damp(sPitch, pitch, 26, dt);

      // --- where the camera wants to be
      target.set(focus.x, HEIGHT, focus.z);
      const cp = Math.cos(sPitch);
      const dirX = Math.sin(sYaw) * cp;
      const dirY = Math.sin(sPitch);
      const dirZ = Math.cos(sYaw) * cp;

      // --- pull in if a building is in the way
      const ox = target.x, oy = target.y, oz = target.z;
      const full = wantDist;
      const dx = dirX * full, dy = dirY * full, dz = dirZ * full;
      let tHit = 1;
      for (let i = 0; i < boxes.length; i++) {
        const t = hitBox(ox, oy, oz, dx, dy, dz, boxes[i]);
        if (t < tHit) tHit = t;
      }
      dist = tHit < 1 ? Math.max(DIST_MIN * 0.75, full * tHit - 0.25) : full;
      // Snap in fast, ease out slow: never let the camera end up inside a wall.
      sDist = dist < sDist ? damp(sDist, dist, 40, dt) : damp(sDist, dist, 6, dt);

      desired.set(
        target.x + dirX * sDist,
        target.y + dirY * sDist,
        target.z + dirZ * sDist
      );
      // Keep the lens above the pavement.
      if (desired.y < 0.45) desired.y = 0.45;

      if (!initialised) {
        camPos.copy(desired);
        initialised = true;
      } else {
        camPos.x = damp(camPos.x, desired.x, 16, dt);
        camPos.y = damp(camPos.y, desired.y, 16, dt);
        camPos.z = damp(camPos.z, desired.z, 16, dt);
      }

      camera.position.copy(camPos);
      camera.lookAt(target.x, target.y - 0.06, target.z);
    },

    /** Aim the rig directly. Used when the game wants to turn the camera, and for QA. */
    look(y, p) {
      yaw = y;
      pitch = clamp(p ?? pitch, PITCH_MIN, PITCH_MAX);
    },

    /** Swing the rig behind the player, e.g. after a teleport. */
    reset(focus, facing = 0) {
      yaw = facing + Math.PI;
      sYaw = yaw;
      pitch = 0.20;
      sPitch = pitch;
      wantDist = 5.4;
      sDist = 5.4;
      initialised = false;
      target.set(focus.x, HEIGHT, focus.z);
      camPos.set(
        target.x + Math.sin(sYaw) * Math.cos(sPitch) * sDist,
        target.y + Math.sin(sPitch) * sDist,
        target.z + Math.cos(sYaw) * Math.cos(sPitch) * sDist
      );
      camera.position.copy(camPos);
      camera.lookAt(target);
    },

    /** Enter or leave the crane shot. Returns the new mode. */
    setAerial(on) {
      const next = on ? 'aerial' : 'follow';
      if (next === mode) return mode;
      mode = next;
      // Entering from a street-level follow shot would otherwise inherit its shallow
      // pitch and give a flat "roof height" view; open on a real overview instead.
      // Leaving restores nothing, so the pitch you set while flying is kept.
      if (next === 'aerial' && sPitch < AERIAL_PITCH_MIN + 0.12) {
        aPitch = 0.70;
        aDist = Math.max(aDist, 190);
      }
      // let the rig drift rather than jump: the smoothed values carry the transition
      return mode;
    },

    toggleAerial() {
      return this.setAerial(mode !== 'aerial');
    },

    /** Direct control of the crane shot, for the HUD and for QA. */
    setAerialPitch(p) { aPitch = clamp(p, AERIAL_PITCH_MIN, AERIAL_PITCH_MAX); },
    setAerialDistance(d) { aDist = clamp(d, AERIAL_DIST_MIN, AERIAL_DIST_MAX); },
    setRoofLookup(fn) { roofLookup = fn; },
    get aerialPitch() { return aPitch; },
    get aerialDistance() { return aDist; }
  };
}