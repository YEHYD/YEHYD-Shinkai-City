// Height fog.
//
// `THREE.Fog` fades by distance only, so a nine-storey tower and the asphalt in front of
// it pick up the same amount of haze. That is why the far end of the street reads as a flat
// grey veil instead of air lying on the ground: nothing about the fog knows how high it is.
//
// This module patches three's fog shader chunks so the haze also depends on the fragment's
// height above the street:
//
//   extra = strength * exp( -( y - ground ) / scale ) * smoothstep( nearZ, farZ, depth )
//
// Below `ground` metres the factor is 1 (full haze), and it falls off by 1/e every `scale`
// metres of height. The depth ramp keeps the near street clean — the previous rounds spent a
// lot of effort getting rid of the "grey film over everything" look, and this must not bring
// it back.
//
// The numbers are baked into the GLSL at install time, so changing them needs a call to
// `setHeightFog()` (or a reload). That is deliberate: a uniform would need to be threaded
// through every material in the scene, and these parameters change once per tuning session,
// not per frame.

import * as THREE from 'three';

export const HEIGHT_FOG = {
  ground: 2.0,     // m: everything below this is at full ground haze
  scale: 12.0,     // m: e-folding height — the layer tops out around the 1st/2nd floor
  strength: 0.35,  // extra fog at full depth, at street level (0..1)
  nearZ: 8.0,      // m: ground haze starts to bite here
  farZ: 60.0       // m: and reaches full strength here
};

// The stock chunks, kept so `setHeightFog(false)` can put them back and A/B the change
// without a reload.
const STOCK = {
  fog_pars_vertex: THREE.ShaderChunk.fog_pars_vertex,
  fog_vertex: THREE.ShaderChunk.fog_vertex,
  fog_pars_fragment: THREE.ShaderChunk.fog_pars_fragment,
  fog_fragment: THREE.ShaderChunk.fog_fragment
};

let installed = false;
let config = { ...HEIGHT_FOG };

function glsl(c) {
  const n = v => Number(v).toFixed(4);

  // `vFogHeight` is the fragment's world height. It is taken from the vertex's model-space
  // position rather than `transformed` so this also compiles for sprites and points, which
  // do not run `begin_vertex`. Skinned meshes give the bind-pose height, which is fine:
  // people are either on the pavement or on it, they do not hang from balconies.
  THREE.ShaderChunk.fog_pars_vertex =
`#ifdef USE_FOG
	varying float vFogDepth;
	varying float vFogHeight;
#endif`;

  THREE.ShaderChunk.fog_vertex =
`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	#ifdef USE_INSTANCING
		vFogHeight = ( modelMatrix * instanceMatrix * vec4( position, 1.0 ) ).y;
	#else
		vFogHeight = ( modelMatrix * vec4( position, 1.0 ) ).y;
	#endif
#endif`;

  THREE.ShaderChunk.fog_pars_fragment =
`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vFogHeight;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;

  THREE.ShaderChunk.fog_fragment =
`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	// The ground term: full at street level, e-folding away with height, faded in by depth
	// so it never hazes what is right in front of the camera.
	float fogGround = exp( - max( vFogHeight - ${n(c.ground)}, 0.0 ) / ${n(c.scale)} );
	float fogRamp = smoothstep( ${n(c.nearZ)}, ${n(c.farZ)}, vFogDepth );
	fogFactor = clamp( fogFactor + ${n(c.strength)} * fogGround * fogRamp, 0.0, 1.0 );
	// A touch darker and cooler than the sky fog: the haze is underlit by the street, and this is
	// what stops the far end of the avenue blowing out into the horizon colour.
	vec3 hazeColor = fogColor * vec3( 0.88, 0.92, 1.00 );
${c.debug === 1 ? `	gl_FragColor.rgb = vec3( clamp( vFogHeight / 40.0, 0.0, 1.0 ), clamp( fogRamp, 0.0, 1.0 ), 0.0 );`
  : c.debug === 2 ? `	gl_FragColor.rgb = vec3( clamp( vFogDepth / 120.0, 0.0, 1.0 ) );`
  : c.debug === 3 ? `	gl_FragColor.rgb = vec3( fogGround, fogRamp, fogFactor );`
  : '	gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor, fogFactor );'}
#endif`;
}

// Bumping `customProgramCacheKey` is what actually makes the renderer rebuild the programs:
// the shader source changes but three's program cache is keyed on the material parameters, so
// without a key of its own every material would keep its first-compiled program and
// `setHeightFog()` would silently do nothing.
function markStale(scene) {
  if (!scene) return;
  scene.traverse(obj => {
    const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
    for (const m of mats) {
      if (!m.fog) continue;
      m.customProgramCacheKey = () => (installed ? 'hf-on' : 'hf-off');
      m.needsUpdate = true;
    }
  });
}

/** Patch three's fog chunks. Must run before the first render. */
export function installHeightFog(opts = {}) {
  config = { ...HEIGHT_FOG, ...opts };
  glsl(config);
  installed = true;
}

/**
 * Turn the height term on or off at runtime. `scene` is needed to force the materials to
 * recompile — the shader source changed, so the cached programs are stale.
 */
export function setHeightFog(on, scene) {
  if (on === installed) return;
  if (on) {
    glsl(config);
  } else {
    Object.assign(THREE.ShaderChunk, STOCK);
  }
  installed = on;
  markStale(scene);
}

export function heightFogConfig() {
  return { ...config };
}