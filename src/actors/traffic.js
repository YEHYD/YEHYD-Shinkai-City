// Traffic: cars running the grid.
//
// Each car owns a lane and a direction, so it can never collide with a kerb or turn into
// a building. Bodies, cabins, headlights and tail lights are four instanced meshes, which
// means the entire traffic of the city costs four draw calls.

import * as THREE from 'three';
import { makeRandom } from '../core/random.js';
import { CELL, HALF, ROAD_HALF } from '../world/layout.js';

const LANE = ROAD_HALF * 0.5;          // 3 m out from the centre line
const CAR_L = 4.3, CAR_W = 1.86, CAR_H = 0.8;

// Braking for pedestrians. A car starts easing off BRAKE_ZONE metres before you and is
// brought to a hard stop two metres short of your feet; pulling away again is gentle
// (ACCEL) so a street full of cars does not lurch every time someone crosses.
const BRAKE_ZONE = 17;
const BRAKE_A = 5.5;
const ACCEL = 2.6;

const PAINT = ['#c9ccd2', '#20232a', '#8e2130', '#2b4f7c', '#d8d2c6', '#3f4a44', '#54414f'];

export function createTraffic(opts = {}) {
  const rnd = makeRandom(31417);
  const count = opts.quality === 'lite' ? 110 : 260;

  const group = new THREE.Group();
  group.name = 'traffic';

  const cars = [];
  const lines = [];
  for (let k = 0; k <= Math.round((HALF * 2) / CELL); k++) {
    lines.push(-HALF + CELL * k);
  }

  for (let i = 0; i < count; i++) {
    // Same stratified pattern as the crowd: one car per road slot, spread along it,
    // so every street carries traffic instead of a few lucky avenues.
    const axis = i % 2 === 0 ? 'z' : 'x';
    const road = lines[Math.floor(i / 2) % lines.length];
    const slot = Math.floor(i / (2 * lines.length));
    const perSlot = Math.max(1, Math.ceil(count / (2 * lines.length)));
    // left-hand traffic: keep left of the direction of travel
    const dir = rnd.chance(0.5) ? 1 : -1;
    const off = axis === 'z' ? dir * LANE : -dir * LANE;
    cars.push({
      axis,
      road,
      off,
      dir,
      t: -HALF + 12 + ((slot + rnd.next()) / perSlot) * (HALF * 2 - 24),
      speed: 9,
      v: 9,                 // speed this frame; only differs from `speed` while braking
      wait: 0,              // seconds spent standing still, for jam release
      paint: new THREE.Color(rnd.pick(PAINT)),
      x: 0, z: 0, yaw: 0
    });
  }

  // ---------------------------------------------------------------- lane queues
  // Cars sharing a carriageway share one speed. Different speeds in one lane meant a car
  // drove *through* the one in front of it; a single speed keeps every gap constant for
  // the whole life of the traffic. The queue array is the lane order, so a car that runs
  // off the end of the grid re-enters at the back of its own queue instead of blinking
  // out — which also keeps the spacing honest.
  const P_MIN = -HALF + 6, P_MAX = HALF - 6, MIN_GAP = 7.2;
  const laneQueues = [];
  {
    const byKey = new Map();
    for (const c of cars) {
      const key = `${c.axis}|${Math.round(c.road)}|${c.dir}`;
      if (!byKey.has(key)) byKey.set(key, { axis: c.axis, road: c.road, dir: c.dir, queue: [] });
      byKey.get(key).queue.push(c);
    }
    for (const lane of byKey.values()) {
      const prog = c => (lane.dir > 0 ? c.t : -c.t);
      lane.queue.sort((a, b) => prog(a) - prog(b));
      // a lane's speed: deterministic per carriageway, so the grid feels varied but stable
      const seed = Math.abs(Math.round(lane.road) * 7 + (lane.axis === 'z' ? 3 : 1) + lane.dir);
      const speed = 6.5 + ((seed * 37) % 61) / 10;   // 6.5 … 12.5 m/s
      for (const c of lane.queue) { c.speed = speed; c.v = speed; }
      laneQueues.push(lane);
    }
  }

  // ---------------------------------------------------------------- meshes
  const bodyGeo = new THREE.BoxGeometry(CAR_W, CAR_H, CAR_L);
  bodyGeo.translate(0, 0.62, 0);
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.55, envMapIntensity: 1.1 });

  const cabinGeo = new THREE.BoxGeometry(CAR_W * 0.84, 0.62, CAR_L * 0.44);
  cabinGeo.translate(0, 1.26, -0.22);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.16, metalness: 0.5 });

  const headGeo = new THREE.PlaneGeometry(CAR_W * 0.78, 0.26);
  headGeo.translate(0, 0.66, CAR_L / 2 + 0.02);
  const headMat = new THREE.MeshBasicMaterial({
    color: 0xfff2d6, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true
  });

  const tailGeo = new THREE.PlaneGeometry(CAR_W * 0.78, 0.2);
  tailGeo.translate(0, 0.72, -CAR_L / 2 - 0.02);
  tailGeo.rotateY(Math.PI);
  const tailMat = new THREE.MeshBasicMaterial({
    color: 0xff2a20, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true
  });

  const mesh = (geo, mat, name, cast) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = cast;
    m.name = name;
    group.add(m);
    return m;
  };

  const body = mesh(bodyGeo, bodyMat, 'car-bodies', true);
  const cabin = mesh(cabinGeo, cabinMat, 'car-cabins', true);
  const head = mesh(headGeo, headMat, 'car-headlights', false);
  const tail = mesh(tailGeo, tailMat, 'car-taillights', false);

  // one colour per car, set once
  for (let i = 0; i < cars.length; i++) body.setColorAt(i, cars[i].paint);
  if (body.instanceColor) body.instanceColor.needsUpdate = true;

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);

  return {
    group,
    cars,

    update(camera, s, dt, player) {
      // --- which crossings are in use right now: bit 1 for north–south, bit 2 for
      // east–west. A car about to enter a box the other axis already holds waits.
      const junction = new Map();
      for (const c of cars) {
        // A car that has been standing still for a while is stuck, not crossing: it must
        // not keep a box reserved, or one jammed car freezes the perpendicular street and
        // the whole grid locks up around it.
        if (c.wait > 1.5) continue;
        const i = Math.round((c.x + HALF) / CELL);
        const j = Math.round((c.z + HALF) / CELL);
        const jx = -HALF + CELL * i, jz = -HALF + CELL * j;
        if (Math.abs(c.x - jx) < 7.5 && Math.abs(c.z - jz) < 7.5) {
          const k = i * 1000 + j;
          junction.set(k, (junction.get(k) || 0) | (c.axis === 'z' ? 1 : 2));
        }
      }

      for (const lane of laneQueues) {
        const q = lane.queue;
        const other = lane.axis === 'z' ? 2 : 1;

        // --- you are a solid thing in the street. A car that finds you standing in its
        // lane brakes behind you and only pulls away again once you step aside; the queue
        // below then stacks up behind it, exactly as it would behind a stopped car.
        // Worked out once per lane, because every car in a lane shares one centreline.
        let stopAt = Infinity;
        if (player) {
          const laneOff = q[0].off;
          const lat = lane.axis === 'z' ? player.x - (lane.road + laneOff)
                                        : player.z - (lane.road + laneOff);
          if (Math.abs(lat) < 2.35) {          // about one car width either side
            const along = lane.axis === 'z' ? player.z : player.x;
            stopAt = lane.dir > 0 ? along : -along;
          }
        }

        let limit = Infinity;
        for (let i = q.length - 1; i >= 0; i--) {
          const c = q[i];
          let p = lane.dir > 0 ? c.t : -c.t;

          // Where this car ought to come to rest this frame, in lane-forward metres.
          // The person is one reason to stop; a crossing it cannot clear is the other.
          let stopPoint = Infinity;
          if (stopAt !== Infinity && stopAt > p) {
            // The person is ahead of this car. Stop two metres short of them; if someone
            // appears right on the bumper (they walked into the lane), stop dead instead
            // of creeping through them.
            stopPoint = Math.max(p, stopAt - (CAR_L / 2 + 2.0));
          }

          // --- if the person is standing in the crossing ahead, wait on the near side of it.
          // Stopping inside the box is what starts a gridlock: the box stays reserved for
          // the cross street, which jams that one in turn.
          const front = p + CAR_L / 2;
          const kBox = Math.ceil((front + 7.5 + HALF) / CELL);
          const boxC = -HALF + CELL * kBox;
          const boxIn = boxC - 7.5 - CAR_L / 2;
          const boxOut = boxC + 7.5 + CAR_L / 2;
          if (p < boxIn && stopPoint > boxIn && stopPoint < boxOut) stopPoint = boxIn;

          // Speed this frame: sqrt(2 a d) is the fastest you may still be going and stop
          // short of the mark, so the car eases off the throttle instead of stamping on
          // the brakes at the last metre.
          let want = c.speed;
          if (stopPoint !== Infinity) {
            const gap = stopPoint - p;
            if (gap <= 0.6) want = 0;
            else if (gap < BRAKE_ZONE) want = Math.min(want, Math.sqrt(2 * BRAKE_A * gap));
          }
          c.v += want > c.v ? Math.min(ACCEL * dt, want - c.v)
                            : -Math.min(BRAKE_A * dt, c.v - want);
          c.v = Math.max(0, Math.min(c.v, c.speed));

          let next = p + c.v * dt;
          // Hard stop at the mark: a long frame must not carry the box through the person,
          // and the car must never reverse to reach the gap.
          if (stopPoint !== Infinity && stopPoint > p) next = Math.min(next, stopPoint);
          // never close on the car ahead: a queue keeps its spacing
          if (next > limit - MIN_GAP) next = Math.max(p, limit - MIN_GAP);

          // A car held up by a queue (or by the player) is standing still, not coasting at
          // full speed: bleed the speed so it pulls away again at a believable rate.
          const moved = next - p;
          if (moved < c.v * dt - 1e-4) c.v = Math.max(0, moved / Math.max(dt, 1e-4));
          c.wait = c.v < 0.5 ? c.wait + dt : 0;

          const tn = lane.dir > 0 ? next : -next;
          const tc = lane.dir > 0 ? p : -p;
          const idx = Math.round((tn + HALF) / CELL);
          const ctr = -HALF + CELL * idx;
          // only hold *before* entering: a car already inside must be allowed to clear it
          if (Math.abs(tn - ctr) < 7.0 && Math.abs(tc - ctr) > 6.0) {
            const road = lane.road + c.off;
            const i2 = lane.axis === 'z' ? Math.round((road + HALF) / CELL) : idx;
            const j2 = lane.axis === 'z' ? idx : Math.round((road + HALF) / CELL);
            // Two lanes can each reserve a box the other needs, and then neither ever
            // moves: the stock grid deadlocks this way after any real blockage. Give way
            // for a while, then go anyway — a grid that freezes forever is worse than a
            // close call at a crossing.
            if ((junction.get(i2 * 1000 + j2) || 0) & other) {
              c.held = (c.held || 0) + dt;
              if (c.held < 2.0) next = p;
            } else {
              c.held = 0;
            }
          } else {
            c.held = 0;
          }

          c.t = lane.dir > 0 ? next : -next;
          limit = next;
        }

        // --- wrap: the head of the lane re-enters at the back of its own queue, so the
        // gaps stay even instead of a car blinking out mid-street
        const headP = () => (lane.dir > 0 ? q[q.length - 1].t : -q[q.length - 1].t);
        if (q.length === 1) {
          if (headP() > P_MAX) {
            const np = P_MIN;
            q[0].t = lane.dir > 0 ? np : -np;
          }
        } else {
          while (headP() > P_MAX) {
            const car = q.pop();
            const tailP = lane.dir > 0 ? q[0].t : -q[0].t;
            const np = tailP - MIN_GAP;
            car.t = lane.dir > 0 ? np : -np;
            q.unshift(car);
          }
        }
      }

      // --- place and draw
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (c.axis === 'z') {
          c.x = c.road + c.off;
          c.z = c.t;
          c.yaw = c.dir > 0 ? 0 : Math.PI;
        } else {
          c.x = c.t;
          c.z = c.road + c.off;
          c.yaw = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }

        pos.set(c.x, 0, c.z);
        quat.setFromAxisAngle(UP, c.yaw);
        m4.compose(pos, quat, one);
        body.setMatrixAt(i, m4);
        cabin.setMatrixAt(i, m4);
        head.setMatrixAt(i, m4);
        tail.setMatrixAt(i, m4);
      }

      body.count = cabin.count = head.count = tail.count = cars.length;
      body.instanceMatrix.needsUpdate = true;
      cabin.instanceMatrix.needsUpdate = true;
      head.instanceMatrix.needsUpdate = true;
      tail.instanceMatrix.needsUpdate = true;

      // lamps only really read after dark; by day they are a faint highlight
      headMat.opacity = 0.10 + 0.85 * s.night;
      tailMat.opacity = 0.18 + 0.72 * s.night;
    },

    dispose() {
      for (const m of [body, cabin, head, tail]) { m.dispose(); m.material.dispose(); }
      bodyGeo.dispose(); cabinGeo.dispose(); headGeo.dispose(); tailGeo.dispose();
    }
  };
}