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
      speed: rnd.range(6.5, 13),
      paint: new THREE.Color(rnd.pick(PAINT)),
      x: 0, z: 0, yaw: 0
    });
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

    update(camera, s, dt) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        c.t += c.dir * c.speed * dt;
        // wrap at the edge: the fog and the far skyline make the ends of the grid a
        // reasonable place for a car to leave the world and come back
        if (c.t > HALF - 4) c.t = -HALF + 4;
        else if (c.t < -HALF + 4) c.t = HALF - 4;

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