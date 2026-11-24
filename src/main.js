// Shinkai City — entry point.
//
// Wiring order matters: the atmosphere is computed first because everything else (sky,
// lights, bloom, characters) reads the same state object.

import * as THREE from 'three';

import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { createHud } from './ui/hud.js';
import { createAtmosphere, tickAtmosphere, atmosphere, clockLabel } from './scene/atmosphere.js';
import { createSky } from './scene/sky.js';
import { createLighting } from './scene/lighting.js';
import { createComposer } from './scene/composer.js';
import { installHeightFog, setHeightFog } from './scene/heightFog.js';
import { setContactAO } from './scene/contactAO.js';
import { generateLayout, collisionBoxes, SPAWN, HALF } from './world/layout.js';
import { buildCity } from './world/city.js';
import { buildFrontage } from './world/frontage.js';
import { createPlayer } from './actors/player.js';
import { loadSprites, createActor, spriteSrc } from './actors/sprite.js';
import { createCrowd } from './actors/crowd.js';
import { createTraffic } from './actors/traffic.js';
import { PLAYER, NPCS } from './actors/roster.js';
import { createThirdPerson } from './camera/thirdPerson.js';
import { createSocial } from './story/social.js';
import { createDialogue } from './story/dialogue.js';
import { createDialoguePanel } from './ui/dialoguePanel.js';
import { createTeleportPanel } from './ui/teleport.js';

const canvas = document.getElementById('view');
const hud = createHud();

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,          // bloom + our own AA via pixel ratio reads cleaner
  powerPreference: 'high-performance',
  stencil: false
});
const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
// r187 dropped PCFSoftShadowMap; PCFShadowMap is the soft-ish option that still exists.
renderer.shadowMap.type = THREE.PCFShadowMap;
// The composer renders several passes per frame, so let the counters accumulate and reset
// them ourselves — otherwise the HUD reports the last fullscreen quad instead of the scene.
renderer.info.autoReset = false;

// `?quality=lite` (or #lite) forces the cheap path — handy when demoing on a weak laptop
// or a projector, where the file is opened straight from disk and there is no console.
const forced = /(?:^|[?&#])quality=(lite|full)\b/.exec(window.location.href)?.[1]
  || (/[?#]lite\b/.test(window.location.href) ? 'lite' : null);
const quality = forced || (dpr > 2 || window.innerWidth < 720 ? 'lite' : 'full');

// Height fog has to be patched in before the first material compiles. `?fog=off` is the A/B
// switch: same camera, same clock, only the haze term changes. `?fogstrength=0.8&fogscale=14`
// retunes it without an edit, which is what the tuning passes use.
const urlNum = (key, fallback) => {
  const hit = new RegExp(`[?&#]${key}=(\\d+(?:\\.\\d+)?)`).exec(window.location.href);
  return hit ? parseFloat(hit[1]) : fallback;
};
installHeightFog({
  strength: urlNum('fogstrength', quality === 'lite' ? 0.30 : 0.35),
  scale: urlNum('fogscale', 12),
  nearZ: urlNum('fognear', 8),
  farZ: urlNum('fogfar', 60),
  // `?fogdebug=1` paints vFogHeight (red) + depth ramp (green), `=2` the raw fog depth,
  // `=3` the ground term / ramp / final factor. Tuning aid only; 0 is off.
  debug: urlNum('fogdebug', 0)
});
const heightFogOn = !/[?&#]fog=off\b/.test(window.location.href);
// `?ao=off` is the A/B switch for the wall-foot darkening; the term is patched into the wall
// materials when the city is built (src/world/city.js), so only the on/off part lives here.
const contactAOOn = !/[?&#]ao=off\b/.test(window.location.href);

// A coarse roof-height grid over the city, for the crane shot. 12 m bins, max height
// wins: cheap to build once, and exact enough to keep the lens out of the towers.
function makeRoofLookup(buildings) {
  const BIN = 12;
  const n = Math.ceil((HALF * 2) / BIN) + 1;
  const grid = new Float32Array(n * n);
  const toBin = v => Math.round((v + HALF) / BIN);
  for (const b of buildings) {
    const x0 = Math.max(0, toBin(b.x - b.w / 2));
    const x1 = Math.min(n - 1, toBin(b.x + b.w / 2));
    const z0 = Math.max(0, toBin(b.z - b.d / 2));
    const z1 = Math.min(n - 1, toBin(b.z + b.d / 2));
    for (let zi = z0; zi <= z1; zi++) {
      for (let xi = x0; xi <= x1; xi++) {
        const i = zi * n + xi;
        if (b.h > grid[i]) grid[i] = b.h;
      }
    }
  }
  return (x, z) => {
    const xi = toBin(x);
    const zi = toBin(z);
    if (xi < 0 || zi < 0 || xi >= n || zi >= n) return 0;
    return grid[zi * n + xi];
  };
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.12, 4200);
camera.position.set(0, 2.4, 8);

// ---------------------------------------------------------------- boot helper
const raf = () => new Promise(r => requestAnimationFrame(() => r()));
async function step(p, msg) {
  hud.boot(p, msg);
  await raf();
  await raf();
}

// ---------------------------------------------------------------- build
let loop = null;
let actors = [];
let focusNpc = null;

async function start() {
  await step(0.05, '正在读取天空');

  const s = createAtmosphere(1055);   // 17:35, the good light
  atmosphere(s);

  await step(0.14, '正在计算建筑轮廓');
  const layout = generateLayout(undefined, {
  // reserve the cast's stand spots first: nobody wants a utility pole through their head
  reserved: NPCS.map(n => ({ x: n.x, z: n.z, r: 1.05 }))
});
  const boxes = collisionBoxes(layout);

  await step(0.28, '正在浇筑街区');
  const city = buildCity(layout, renderer);
  scene.add(city.group);

  // Shop fronts, awnings, vending machines, poles and signals: the clutter that makes a
  // street read as inhabited rather than as a model of a street.
  const frontage = buildFrontage(layout, { quality });
  scene.add(frontage.group);

  await step(0.46, '正在点亮窗户');
  const sky = createSky(scene, { quality });
  const lighting = createLighting(renderer, scene, { quality });
  const composer = createComposer(renderer, scene, camera, { quality });

  await step(0.60, '正在装载行人');
  let sprites = {};
  try {
    // The single-file build inlines the drawings as data: URLs — a file:// page cannot
    // fetch them, so there is nothing to load over the network at all.
    const inline = window.__SHINKAI_ASSETS || null;
    const manifest = inline
      ? inline.manifest
      : await fetch('./assets/characters/manifest.json').then(r => {
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        return r.json();
      });
    sprites = await loadSprites(manifest, './assets/characters', inline ? inline.files : null);
  } catch (err) {
    console.warn('[shinkai] character sprites unavailable:', err.message);
  }

  await step(0.86, '正在把街道交给你');

  const input = createInput(canvas);
  const player = createPlayer(boxes, { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw });
  const cam = createThirdPerson(camera, input, boxes);
  cam.reset(player.position, player.facing);
  // The crane shot needs to know how tall the city is under it, or it parks inside a
  // tower. A coarse height grid is enough: bins are 12 m and roofs are box footprints.
  cam.setRoofLookup(makeRoofLookup(layout.buildings));

  // The player is an actor too, so the same billboard code draws them: walking towards a
  // lamp shows their back, turning around shows their face.
  let self = null;
  if (sprites.player) {
    self = createActor({ ...PLAYER, x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw }, sprites.player);
    scene.add(self.group);
  }

  for (const def of NPCS) {
    if (!sprites[def.id]) continue;
    const a = createActor(def, sprites[def.id], { marker: true });
    scene.add(a.group);
    actors.push(a);
  }

  // ---------------------------------------------------------------- extras
  const crowd = createCrowd(sprites, { quality, props: layout.props, npcs: NPCS });
  scene.add(crowd.group);

  const traffic = createTraffic({ quality });
  scene.add(traffic.group);

  // ---------------------------------------------------------------- social layer
  // The street keeps its own books: who likes you, who heard what, and from whom.
  const social = createSocial(NPCS);
  const dialogue = createDialogue(social);
  const actorById = new Map(actors.map(a => [a.def.id, a]));

  let convo = null;
  function chooseIndex(index) {
    if (!convo || panel.typing) return;
    const opt = convo.options[index];
    if (!opt) return;
    if (opt.tag === 'end') { closeTalk(); return; }
    if (dialogue.choose(index) !== null) panel.replace(convo);
  }

  const panel = createDialoguePanel({
    onChoose: chooseIndex,
    // Same resolution rule as the in-scene sprites, so the portrait still shows up when the
    // page is opened straight off disk and the drawings live inline as data: URLs.
    faceSrc: (id) => spriteSrc(id, 'front', './assets/characters', window.__SHINKAI_ASSETS ? window.__SHINKAI_ASSETS.files : null)
  });

  const feedEl = document.getElementById('feed');
  const feedLines = [];
  social.onEvent(ev => {
    if (ev.kind !== 'spread') return;         // only the interesting half: gossip moving
    const el = document.createElement('div');
    el.textContent = `${social.nameOf(ev.who)} → ${social.nameOf(ev.to)}：${ev.topic}`;
    feedEl.appendChild(el);
    feedLines.push(el);
    if (feedLines.length > 3) feedLines.shift().remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 520);
      const i = feedLines.indexOf(el);
      if (i >= 0) feedLines.splice(i, 1);
    }, 4600);
  });

  function openTalk(a) {
    convo = dialogue.begin(a.def.id);
    if (!convo) return;
    panel.show(convo);
    hud.focus(null);
    a.setMarker(false);   // the mark has done its job once you are in the conversation
    input.exitLock();     // you need the cursor to click the options
  }

  function closeTalk() {
    const who = convo && actorById.get(convo.npcId);
    if (who) who.setMarker(true);
    convo = null;
    panel.close();
    dialogue.end();
    focusNpc = null;      // force the prompt to re-detect on the next frame
  }

  // ---------------------------------------------------------------- teleporting
  // Clicking the plan can land inside a footprint, so walk outwards until there is
  // pavement. Same radius the walking collision uses, so the landing spot is always legal.
  const SAFE_R = 0.9;
  const STAND_OFF = 2.05;
  function blockedAt(px, pz) {
    if (Math.abs(px) > HALF - 6 || Math.abs(pz) > HALF - 6) return true;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const r = b.pad ?? SAFE_R;
      if (px > b.minX - r && px < b.maxX + r &&
          pz > b.minZ - r && pz < b.maxZ + r) return true;
    }
    return false;
  }

  function safeSpot(x, z) {
    if (!blockedAt(x, z)) return { x, z };
    for (let r = 1.6; r <= 60; r += 1.6) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const px = x + Math.cos(ang) * r;
        const pz = z + Math.sin(ang) * r;
        if (!blockedAt(px, pz)) return { x: px, z: pz };
      }
    }
    return { x: SPAWN.x, z: SPAWN.z };
  }

  function goTo(hit) {
    const who = hit.npcId ? actorById.get(hit.npcId) : null;
    // Land *in front of* a character, not inside them: standing on the same metre
    // fuses the two billboards and hides the one you came to talk to.
    let ax = hit.x;
    let az = hit.z;
    if (who) {
      const d = Math.hypot(hit.x - player.position.x, hit.z - player.position.z);
      // Approach along the line we came from; fall back to +z when we were already there.
      const nx = d > 0.5 ? (hit.x - player.position.x) / d : 0;
      const nz = d > 0.5 ? (hit.z - player.position.z) / d : 1;
      ax = who.position.x + nx * STAND_OFF;
      az = who.position.z + nz * STAND_OFF;
    }
    const spot = safeSpot(ax, az);
    player.teleport(spot.x, spot.z);
    if (who) {
      const yaw = Math.atan2(who.position.x - spot.x, who.position.z - spot.z);
      player.setFacing(yaw);
      cam.setAerial(false);
      cam.reset(player.position, yaw);
    } else {
      cam.setAerial(false);
      cam.reset(player.position, player.facing);
    }
    if (self) self.moveTo(spot.x, spot.z);
    focusNpc = null;
  }

  const map = createTeleportPanel({
    layout,
    npcs: NPCS,
    onPick: goTo,
    getPlayer: () => ({ x: player.position.x, z: player.position.z, facing: player.facing })
  });

  // ---------------------------------------------------------------- pointer lock & pause
  // The pointer is captured while you walk: the mouse turns the camera directly. Escape is
  // the browser's own "give the cursor back", so losing the lock means we pause — one key,
  // no custom handler, and the cursor is guaranteed to be visible while paused.
  // Opening a panel releases the pointer on purpose (you want to click the options), so a
  // deliberate release must not look like a pause.
  const pauseEl = document.getElementById('pause');
  const reticle = document.getElementById('reticle');
  let paused = false;
  let everLocked = false;
  function setPaused(on) {
    if (paused === on) return;
    paused = on;
    pauseEl.classList.toggle('on', on);
  }
  input.onLock(locked => {
    reticle.classList.toggle('on', locked);
    if (locked) { everLocked = true; setPaused(false); }
    else if (everLocked && !panel.open && !map.isOpen) setPaused(true);
  });
  const grabPointer = () => {
    if (panel.open || map.isOpen || cam.aerial) return;
    setPaused(false);
    input.requestLock();
  };
  canvas.addEventListener('click', grabPointer);
  pauseEl.addEventListener('click', grabPointer);

  // ---------------------------------------------------------------- resize
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  // ---------------------------------------------------------------- frame
  const state = { forward: 0, right: 0, run: false };
  const FOCUS_RANGE = 3.2;

  loop = createLoop((dt, time) => {
    renderer.info.reset();
    const raw = input.sample();
    const talking = panel.open;

    // --- conversation keys. E opens, and also fast-forwards the typewriter.
    if (input.takePressed('KeyM')) {
      if (talking) closeTalk();
      map.toggle();
      if (map.isOpen) input.exitLock(); else if (!paused) input.requestLock();
    }
    if (input.takePressed('KeyV')) { map.close(); cam.toggleAerial(); input.exitLock(); }
    if (input.takePressed('Escape')) {
      if (map.isOpen) { map.close(); if (!paused) input.requestLock(); }
      else if (talking) closeTalk();
    }
    if (input.takePressed('KeyE') && !map.isOpen && !cam.aerial) {
      if (!talking) { if (focusNpc) openTalk(focusNpc); }
      else if (panel.typing) panel.skip();
      else if (convo && convo.done) closeTalk();   // E is also "done talking"
    }
    if (talking) {
      for (let i = 0; i < 3; i++) {
        if (input.takePressed(`Digit${i + 1}`)) chooseIndex(i);
      }
    }

    // Talking freezes the feet but not the world: the street keeps gossiping behind you.
    // The map and the crane shot freeze them too — you are looking, not walking. Paused
    // (pointer released) stops the clock as well: coming back should find the street where
    // you left it, not two minutes later.
    const frozen = talking || map.isOpen || cam.aerial || paused;
    const sdt = paused ? 0 : dt;
    state.forward = frozen ? 0 : raw.forward;
    state.right = frozen ? 0 : raw.right;
    state.run = frozen ? false : raw.run;

    // time of day: [ and ] nudge the clock, useful for judging the light
    if (input.takePressed('BracketLeft')) s.minute -= 20;
    if (input.takePressed('BracketRight')) s.minute += 20;

    tickAtmosphere(s, sdt);
    atmosphere(s);
    social.tick(sdt);

    player.update(sdt, state, cam.yaw);
    cam.update(sdt, player.position);

    sky.update(s, time);
    city.update(s);
    frontage.update(s);
    lighting.update(s, sdt, player.position);
    composer.update(s);

    // --- nearest character, for the prompt
    let best = null, bestD = FOCUS_RANGE * FOCUS_RANGE;
    for (const a of actors) {
      const dx = a.position.x - player.position.x;
      const dz = a.position.z - player.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = a; }
    }
    if (talking) {
      // Turn the pair towards each other so neither is talking to a back.
      const who = convo && actorById.get(convo.npcId);
      if (who) {
        const dx = player.position.x - who.position.x;
        const dz = player.position.z - who.position.z;
        who.setFacing(Math.atan2(dx, dz));
        player.setFacing(Math.atan2(-dx, -dz));
      }
    } else if (best !== focusNpc) {
      focusNpc = best;
      hud.focus(best ? `${best.name} · ${best.def.role}` : null);
    }
    if (frozen) { focusNpc = null; hud.focus(null); }

    for (let i = 0; i < actors.length; i++) actors[i].update(camera, s, time);
    crowd.update(camera, s, sdt, time);
    traffic.update(camera, s, sdt);

    if (self) {
      self.moveTo(player.position.x, player.position.z);
      self.setFacing(player.facing);
      self.update(camera, s, time);
    }

    composer.render();

    hud.update({
      clock: clockLabel(s),
      phase: s.phase,
      district: districtName(player.position.x, player.position.z),
      fps: loop.fps,
      x: player.position.x,
      z: player.position.z,
      drawcalls: renderer.info.render.calls,
      npcCount: actors.length
    });
  });

  hud.boot(1, '');
  hud.ready();
  loop.start();

  // Height fog is patched into the shader source, so flipping it at runtime needs a
  // recompile. `__shinkai.fog(false)` does that; handy for A/B screenshots.
  if (!heightFogOn) setHeightFog(false, scene);
  if (!contactAOOn) setContactAO(false, scene);

  // Handy for poking at the scene from the console during visual QA.
  window.__shinkai = { scene, camera, renderer, s, player, cam, actors, layout, sky, lighting, city, composer, input, sprites, self, social, dialogue, panel, frontage, crowd, traffic, map, safeSpot, THREE,
    get paused() { return paused; }, setPaused, grabPointer,
    fog: on => setHeightFog(on !== false, scene),
    ao: on => setContactAO(on !== false, scene) };
  console.log('%c[shinkai] ready', 'color:#7fb2ff', `buildings=${layout.buildings.length}`, `npc=${actors.length}`, `quality=${quality}`);
}

function districtName(x, z) {
  const ns = z < -40 ? '北' : z > 40 ? '南' : '';
  const ew = x < -40 ? '西' : x > 40 ? '东' : '';
  if (!ns && !ew) return '中央大道';
  return `${ns}${ew}街区`;
}

start().catch(err => {
  console.error('[shinkai] failed to start', err);
  hud.boot(0, `启动失败：${err.message}`);
});

window.addEventListener('beforeunload', () => {
  loop?.stop();
});