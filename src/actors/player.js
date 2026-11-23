// The walker. Position, velocity, facing, and axis-separated collision against the
// building footprints.
//
// Collision is resolved one axis at a time so sliding along a facade feels natural
// instead of sticking.

import * as THREE from 'three';
import { damp, clamp } from '../core/random.js';

const RADIUS = 0.42;
const WALK = 2.7;      // m/s
const RUN = 6.1;
const ACCEL = 14;
const LIMIT = 236;     // keep the player inside the ground plane

export function createPlayer(boxes, spawn) {
  const position = new THREE.Vector3(spawn.x, 0, spawn.z);
  const velocity = new THREE.Vector3();
  let facing = spawn.yaw ?? 0;
  let speed = 0;
  let stride = 0;

  function blocked(x, z) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x > b.minX - RADIUS && x < b.maxX + RADIUS && z > b.minZ - RADIUS && z < b.maxZ + RADIUS) {
        return true;
      }
    }
    return false;
  }

  return {
    position,
    get facing() { return facing; },
    get speed() { return speed; },
    /** 0..1 phase of the walk cycle, for the sprite's step bob */
    get stride() { return stride; },

    /**
     * @param {number} dt
     * @param {{forward:number,right:number,run:boolean}} input
     * @param {number} camYaw camera yaw so W always means "away from the camera"
     */
    update(dt, input, camYaw) {
      // Movement axes in camera space.
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      let mx = input.right * cos - input.forward * sin;
      let mz = -input.right * sin - input.forward * cos;
      const len = Math.hypot(mx, mz);
      if (len > 0.0001) {
        mx /= len; mz /= len;
      }

      const target = len > 0.0001 ? (input.run ? RUN : WALK) : 0;
      speed = damp(speed, target, ACCEL, dt);

      if (len > 0.0001) {
        // Turn to face the movement direction, shortest way round.
        const want = Math.atan2(mx, mz);
        let d = want - facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        facing += d * Math.min(1, dt * 12);
      }

      stride += speed * dt * 1.9;

      const dx = mx * speed * dt;
      const dz = mz * speed * dt;

      // --- axis separated
      if (dx !== 0) {
        const nx = clamp(position.x + dx, -LIMIT, LIMIT);
        if (!blocked(nx, position.z)) position.x = nx;
      }
      if (dz !== 0) {
        const nz = clamp(position.z + dz, -LIMIT, LIMIT);
        if (!blocked(position.x, nz)) position.z = nz;
      }
    },

    teleport(x, z) {
      position.set(x, 0, z);
      velocity.set(0, 0, 0);
      speed = 0;
    },

    /** Point the body somewhere without walking (e.g. turning to face who you are talking to). */
    setFacing(yaw) {
      facing = yaw;
    }
  };
}