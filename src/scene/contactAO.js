// Contact darkening for walls.
//
// Nothing in the scene darkens a facade where it meets the pavement: the only shadowing is
// the sun's shadow map, and at midday that leaves every wall foot as bright as the wall top.
// Real streets never look like that — the ground bounces almost nothing back up, the shop
// canopies and the neighbouring buildings cut the sky, and the wall foot sits in its own
// small ambient pocket. That missing gradient is a large part of why the city reads as
// cardboard up close.
//
// This paints a vertical ambient term straight into the wall material, in two stages,
// because a single ramp either reads as a painted band (too wide) or as nothing at all
// (too weak):
//
//   ao = mix( 1, coreFloor, exp( -y / core ) ) * mix( 1, tailFloor, exp( -y / tail ) )
//
//   core: the contact line — dark, but gone within ~0.3 m, like real occlusion
//   tail: the bounce-light falloff — a wide, barely-there lift up the first floors
//
// It costs one multiply per wall fragment and no extra draw call, which is why it is
// preferred over a full GTAO pass here: the look is flat and stylised, and GTAO's noise and
// corner dirt would fight it.
//
// The numbers are baked into the shader at install time (see heightFog.js for the same
// trade-off), and the material's program cache key carries the on/off state so toggling it
// actually recompiles.

import * as THREE from 'three';

export const CONTACT_AO = {
  coreFloor: 0.62,  // brightness right at the pavement
  core: 0.38,       // m: how fast the contact line dies away
  tailFloor: 0.85,  // brightness of the broad falloff, on top of the core
  tail: 1.5         // m: how far up the wall the falloff reaches
};

let installed = false;
let config = { ...CONTACT_AO };
const patched = new WeakSet();

// Tuning aid: `?aostrength=0.38` (how much darker the contact line gets) and
// `?aofalloff=0.5` (its reach in metres) retune the term from the address bar, the same way
// the fog does.
function urlOverrides() {
  const num = key => {
    const hit = new RegExp(`[?&#]${key}=(\\d+(?:\\.\\d+)?)`).exec(window.location.href);
    return hit ? parseFloat(hit[1]) : null;
  };
  const out = {};
  const strength = num('aostrength');
  const falloff = num('aofalloff');
  if (strength !== null) out.coreFloor = Math.max(0.02, Math.min(1, 1 - strength));
  if (falloff !== null) out.core = Math.max(0.05, falloff);
  return out;
}

function glsl(c) {
  const n = v => Number(v).toFixed(4);
  return {
    vertexPars: '#include <common>\nvarying float vAoHeight;',
    vertexBody: `#include <begin_vertex>
	vAoHeight = ( modelMatrix * vec4( position, 1.0 ) ).y;`,
    fragmentPars: '#include <common>\nvarying float vAoHeight;',
    fragmentBody: `	// Contact line plus the wide bounce falloff, at the foot of the wall. Applied before fog so
	// the haze blends over the darkened wall instead of brightening it back up.
	float caoY = max( vAoHeight, 0.0 );
	float cao = mix( 1.0, ${n(c.coreFloor)}, exp( -caoY / ${n(c.core)} ) )
	          * mix( 1.0, ${n(c.tailFloor)}, exp( -caoY / ${n(c.tail)} ) );
	gl_FragColor.rgb *= cao;
#include <fog_fragment>`
  };
}

/** Patch one wall-like material in place. */
export function installContactAO(material, opts = {}) {
  config = { ...CONTACT_AO, ...urlOverrides(), ...opts };
  if (patched.has(material)) return material;
  patched.add(material);

  material.onBeforeCompile = shader => {
    if (!installed) return;
    const code = glsl(config);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', code.vertexPars)
      .replace('#include <begin_vertex>', code.vertexBody);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', code.fragmentPars)
      .replace('#include <fog_fragment>', code.fragmentBody);
  };
  material.customProgramCacheKey = () => (installed ? 'cao-on' : 'cao-off');
  material.needsUpdate = true;
  installed = true;
  return material;
}

/** Turn the term on or off at runtime; every patched material is rebuilt. */
export function setContactAO(on, scene) {
  if (on === installed) return;
  installed = on;
  if (!scene) return;
  scene.traverse(obj => {
    const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
    for (const m of mats) {
      if (!patched.has(m)) continue;
      m.needsUpdate = true;
    }
  });
}

export function contactAOConfig() {
  return { ...config };
}