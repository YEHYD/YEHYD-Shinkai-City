// The city's state at one moment: where the sun and moon are, what colour the sky is,
// how strong and how warm the key light is, the haze colour, and the exposure.
//
// Everything that draws light reads this one object, so the sky, the fog, the buildings
// and the characters can never disagree about what time it is. It is filled in place
// every frame — no allocation, no garbage.
//
// The colour keys and the arc maths follow the approach in yans_little_town
// (MIT); the values are retuned here for a high-rise skyline rather than a small town.

import * as THREE from 'three';
import { smooth, mod, clamp } from '../core/random.js';

// The sun's centre crosses the horizon at these minutes (06:00 and 19:00).
export const SUNRISE = 360;
export const SUNSET = 1140;
// Arc lean toward the south, so noon is not straight overhead.
const SUN_LEAN = 0.6;
// The key light never rakes in flatter than this, or shadows at dusk turn into mush.
const KEY_MIN_ELEVATION = 0.24;
const MOON_KEY_MIN_ELEVATION = 0.6;
const MOONRISE = 1110;
const MOONSET = 1440 + 400;
const MOON_LEAN = 1.27;

// Colour keys in sRGB. `ground` is the haze low over the city and tints the fog.
const KEYS = {
  day: {
    zenith: '#2f6fc4', horizon: '#c6dcee', ground: '#b9c8d4',
    // A 3.6 key against a 1.5 fill is a hard, contrasty sun (every facade facing it lands on
    // the shoulder of the tonemap). Lower the key, raise the fill: same exposure, much less
    // glare, and shadows stop reading as black holes.
    light: '#fff4e4', lightI: 2.55, hemiSky: '#dfe9f2', hemiGround: '#9c9382', hemiI: 1.92,
    env: 0.4, exposure: 1.0
  },
  warm: {
    zenith: '#2b3f74', horizon: '#f6a468', ground: '#bb8a72',
    light: '#ffa45c', lightI: 1.78, hemiSky: '#e5ab8a', hemiGround: '#6b5442', hemiI: 1.72,
    env: 0.38, exposure: 1.14
  },
  night: {
    zenith: '#03060f', horizon: '#1b2742', ground: '#101828', light: '#c4cfe8',
    lightI: 0.42, hemiSky: '#5d6a86', hemiGround: '#23252d', hemiI: 1.26,
    env: 0.22, exposure: 1.5
  }
};
const SUN_DISC_HIGH = new THREE.Color('#fff6e6');
const SUN_DISC_LOW = new THREE.Color('#ff8a3c');
const SUN_GLOW_HIGH = new THREE.Color('#ffd9ad');
const SUN_GLOW_LOW = new THREE.Color('#ff9a55');
const MOON_COLOR = new THREE.Color('#e9eef8');
const WARM_SKY = new THREE.Color('#ff8b4c');

const COLOR_KEYS = ['zenith', 'horizon', 'ground', 'light', 'hemiSky', 'hemiGround'];
const KEY_COLORS = Object.fromEntries(
  Object.entries(KEYS).map(([k, v]) => [k, Object.fromEntries(COLOR_KEYS.map(c => [c, new THREE.Color(v[c])]))])
);

// Direction of a body on a tilted arc: east at phase 0, highest at 0.5, west at 1.
function arc(phase, lean, out) {
  const a = Math.PI * phase;
  const up = Math.sin(a);
  return out.set(Math.cos(a), up * Math.cos(lean), up * Math.sin(lean)).normalize();
}

export function createAtmosphere(minute = 1055) {
  return {
    minute,
    // speed of the clock, in town-minutes per real second
    speed: 2.4,
    daylight: 1, warm: 0, night: 0,
    sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(), keyDir: new THREE.Vector3(),
    sunUp: 0, moonUp: 0, keyIsMoon: false,
    lightColor: new THREE.Color(), lightIntensity: 0,
    zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), fog: new THREE.Color(),
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 1,
    sunColor: new THREE.Color(), sunGlow: new THREE.Color(), warmSky: new THREE.Color(WARM_SKY),
    moonColor: new THREE.Color(MOON_COLOR),
    sunDisc: 26, env: 0.4, exposure: 1, stars: 0, siderealHours: 0,
    phase: ''
  };
}

/** Advance the clock. `dt` in seconds. Returns the same state object. */
export function tickAtmosphere(s, dt) {
  s.minute = mod(s.minute + dt * s.speed, 1440);
  return s;
}

/** Fill (or refill) the state for the current minute. */
export function atmosphere(s) {
  const m = mod(s.minute, 1440);

  // Sun and moon.
  arc((m - SUNRISE) / (SUNSET - SUNRISE), SUN_LEAN, s.sunDir);
  const moonPhase = mod(m - MOONRISE, 1440) / (MOONSET - MOONRISE);
  arc(moonPhase, MOON_LEAN, s.moonDir);
  s.sunUp = smooth(-0.04, 0.03, s.sunDir.y);
  s.moonUp = moonPhase <= 1 ? smooth(-0.02, 0.05, s.moonDir.y) : 0;

  // daylight from the sun's own elevation, so the sky and the lights always agree.
  const daylight = smooth(-0.06, 0.26, s.sunDir.y);
  // The warm key. Deliberately wide: the golden hour should last long enough to walk
  // through the whole city in, not flash past in twenty seconds of wall clock.
  const warm = smooth(0.55, 0.10, s.sunDir.y) * smooth(-0.12, 0.06, s.sunDir.y);
  s.daylight = daylight;
  s.warm = warm;
  s.night = 1 - daylight;

  // Blend night -> day, then toward the warm key.
  const D = KEY_COLORS.day, N = KEY_COLORS.night, W = KEY_COLORS.warm;
  const w = warm * (0.35 + 0.65 * daylight);
  for (const c of COLOR_KEYS) {
    if (c === 'light') continue;
    s[c].copy(N[c]).lerp(D[c], daylight).lerp(W[c], w);
  }
  // The haze is the horizon colour pushed toward the ground tint — this is what makes
  // the far towers melt into the sky instead of ending at a hard line.
  s.fog.copy(s.horizon).lerp(s.ground, 0.25);

  const blend = k => (KEYS.night[k] + (KEYS.day[k] - KEYS.night[k]) * daylight) * (1 - w) + KEYS.warm[k] * w;
  s.hemiIntensity = blend('hemiI');
  s.env = blend('env');
  s.exposure = blend('exposure');
  s.stars = smooth(0.32, 0.0, daylight);

  // Key light: the sun by day, the moon by night. The swap happens while both are faint,
  // so the shadows never jump.
  const SWAP = 0.08;
  if (daylight > SWAP) {
    s.keyIsMoon = false;
    s.keyDir.copy(s.sunDir);
    const sunWarm = 1 - smooth(0.06, 0.55, s.sunDir.y);
    s.lightColor.copy(D.light).lerp(W.light, Math.max(sunWarm, warm * 0.7));
    s.lightIntensity = KEYS.day.lightI * smooth(SWAP, 0.6, daylight) * (1 - 0.3 * warm);
  } else {
    s.keyIsMoon = true;
    s.keyDir.copy(s.moonDir);
    s.lightColor.copy(N.light);
    s.lightIntensity = KEYS.night.lightI * smooth(SWAP, 0.0, daylight) * (0.35 + 0.65 * s.moonUp);
  }
  // Hold the key light above a minimum elevation so shadows stay readable.
  const lowest = s.keyIsMoon ? MOON_KEY_MIN_ELEVATION : KEY_MIN_ELEVATION;
  const minY = Math.sin(lowest);
  if (s.keyDir.y < minY) {
    const hx = s.keyDir.x, hz = s.keyDir.z, hl = Math.hypot(hx, hz) || 1, c = Math.cos(lowest);
    s.keyDir.set((hx / hl) * c, minY, (hz / hl) * c);
  }

  // Sun disc: white-gold high up, deep orange at the horizon.
  const low = 1 - smooth(0.0, 0.4, s.sunDir.y);
  s.sunColor.copy(SUN_DISC_HIGH).lerp(SUN_DISC_LOW, low);
  s.sunGlow.copy(SUN_GLOW_HIGH).lerp(SUN_GLOW_LOW, low);
  s.sunDisc = 3 + 23 * (1 - low) * (1 - low);

  // Sidereal time, so the stars wheel through the night at a believable rate.
  s.siderealHours = 17.9 + ((m - 1260) / 60) * 1.0027;

  s.phase = phaseName(m, s.sunDir.y, warm);
  return s;
}

function phaseName(m, sunY, warm) {
  const rising = m < 720;
  if (sunY < -0.07) return '深夜';
  if (sunY < 0.09) return rising ? '黎明' : '入夜';
  if (warm > 0.55) return rising ? '日出' : '黄昏';
  if (warm > 0.20) return rising ? '清晨' : '傍晚';
  if (sunY > 0.58) return '正午';
  return rising ? '上午' : '午后';
}

/** "17:35" for the HUD. */
export function clockLabel(s) {
  const m = Math.floor(mod(s.minute, 1440));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export { clamp };