// The social layer: what everyone in the street knows, how they feel, and how one
// conversation leaks into the rest of the cast.
//
// The model is deliberately small and legible:
//   * every resident holds a mood (-1..1), a trust in the player (0..1), and a list of
//     remembered *rumours*;
//   * talking plants a rumour in the person you talked to;
//   * on a slow tick, rumours spread along the relationship links, losing weight and
//     picking up the name of whoever passed them on;
//   * mood and trust also drift along those links, so a good conversation with one
//     resident quietly warms the people around them.
//
// Nothing here is random noise for its own sake: the weight of a rumour is what decides
// whether the next person mentions it, how they say it, and how it colours their mood.

import { makeRandom } from '../core/random.js';

// How readily a rumour crosses a given kind of relationship. A sibling tells you
// everything; a rival repeats it with an edge; a stranger barely passes it on at all.
const RELATION_WEIGHT = {
  sibling: 0.86,
  friend: 0.78,
  'old-friend': 0.70,
  patron: 0.62,
  rival: 0.55,
  acquaintance: 0.46,
  stranger: 0.28
};

const TALK_TICK = 1.15;      // seconds between diffusion steps
const DECAY = 0.985;         // rumour weight lost per step (~2 min from strong to forgotten)
const FLOOR = 0.14;          // below this a rumour is forgotten
const MOOD_DRIFT = 0.035;    // how fast a neighbour's mood pulls on yours
const TRUST_BASE = 0.30;     // what trust relaxes back to when nobody is talking to you
const TRUST_DRIFT = 0.004;   // per diffusion step

const MOOD_TAGS = { calm: 0.15, curious: 0.30, composed: 0.20, guarded: -0.25, distant: -0.10, watchful: 0.0, amused: 0.25 };

export function createSocial(npcList, seed = 20261123) {
  const rnd = makeRandom(seed);
  const nodes = new Map();

  for (const def of npcList) {
    nodes.set(def.id, {
      id: def.id,
      def,
      mood: MOOD_TAGS[def.mood] ?? 0,
      trust: 0.34,
      memories: [],     // { topic, tone, from, weight, born, spread:Set<id> }
      edges: def.links || {},
      talkedTo: 0
    });
  }

  const log = [];        // recent social events, newest last
  const listeners = [];
  let clock = 0;
  let accum = 0;

  const nameOf = id => nodes.get(id)?.def.name ?? id;

  function pushLog(entry) {
    entry.at = clock;
    log.push(entry);
    if (log.length > 40) log.shift();
    for (const fn of listeners) fn(entry);
  }

  function remember(node, memory) {
    // Same topic from the same source replaces rather than stacks.
    const existing = node.memories.find(m => m.topic === memory.topic && m.from === memory.from);
    if (existing) {
      existing.weight = Math.min(1, existing.weight * 0.5 + memory.weight);
      existing.born = clock;
      return;
    }
    node.memories.push(memory);
    if (node.memories.length > 8) {
      node.memories.sort((a, b) => b.weight - a.weight);
      node.memories.pop();
    }
  }

  /** The strongest thing a resident currently believes about the player. */
  function topMemory(id, minWeight = 0.2) {
    const node = nodes.get(id);
    if (!node) return null;
    let best = null;
    for (const m of node.memories) if (m.weight >= minWeight && (!best || m.weight > best.weight)) best = m;
    return best;
  }

  function neighbours(id) {
    return Object.keys(nodes.get(id).edges);
  }

  return {
    nodes,
    log,

    onEvent(fn) { listeners.push(fn); },

    get clock() { return clock; },

    /** The player said something with a tone to someone. */
    speak(npcId, { topic, tone, text }) {
      const node = nodes.get(npcId);
      if (!node) return;
      node.talkedTo++;
      node.trust = Math.max(0, Math.min(1, node.trust + tone * 0.10));
      node.mood = Math.max(-1, Math.min(1, node.mood + tone * 0.28));
      remember(node, {
        topic, tone, from: npcId, via: null,
        weight: 0.62 + Math.abs(tone) * 0.30,
        born: clock, spread: new Set([npcId])
      });
      pushLog({ kind: 'talk', who: npcId, tone, topic, text });
    },

    /** Force a rumour to exist without a conversation (used by scripted beats). */
    inject(npcId, memory) {
      const node = nodes.get(npcId);
      if (!node) return;
      remember(node, { spread: new Set([npcId]), born: clock, via: null, ...memory });
    },

    /** Advance the street. Call every frame; it self-throttles. */
    tick(dt) {
      clock += dt;
      accum += dt;
      if (accum < TALK_TICK) return;
      accum = 0;

      // --- 1. pass rumours along relationships
      for (const node of nodes.values()) {
        for (const m of node.memories) {
          if (m.weight < 0.24) continue;
          for (const [otherId, kind] of Object.entries(node.edges)) {
            if (m.spread.has(otherId)) continue;
            const other = nodes.get(otherId);
            if (!other) continue;
            const reach = RELATION_WEIGHT[kind] ?? 0.4;
            // A rumour that has already travelled a long way does not jump as easily.
            const fatigue = Math.max(0.35, 1 - m.spread.size * 0.12);
            if (!rnd.chance(0.55 * reach * fatigue)) continue;

            remember(other, {
              topic: m.topic,
              tone: m.tone,
              from: m.from,
              via: m.from === node.id ? null : node.id,
              weight: m.weight * reach * 0.92,
              born: clock,
              spread: new Set([...m.spread, otherId])
            });
            m.spread.add(otherId);

            if (m.weight * reach > 0.34) {
              pushLog({
                kind: 'spread', who: node.id, to: otherId, topic: m.topic, tone: m.tone,
                text: `${nameOf(node.id)} → ${nameOf(otherId)}`
              });
            }
          }
        }
      }

      // --- 2. decay, forget, and let moods bleed along the links
      for (const node of nodes.values()) {
        for (const m of node.memories) m.weight *= DECAY;
        node.memories = node.memories.filter(m => m.weight >= FLOOR);

        const ns = neighbours(node.id).map(id => nodes.get(id)).filter(Boolean);
        if (ns.length) {
          let sum = 0;
          for (const n of ns) sum += n.mood;
          const avg = sum / ns.length;
          node.mood += (avg - node.mood) * MOOD_DRIFT;
        }
        node.mood = Math.max(-1, Math.min(1, node.mood));
        // Trust drifts back towards a neutral baseline instead of only ever climbing —
        // otherwise a couple of kind words would make the whole street your friend forever.
        node.trust += (TRUST_BASE - node.trust) * TRUST_DRIFT;
      }
    },

    topMemory,
    nameOf,
    neighbours,

    /** A short, human-readable snapshot of one resident, for the HUD/debug. */
    describe(id) {
      const n = nodes.get(id);
      if (!n) return '';
      const m = topMemory(id);
      const moodWord = n.mood > 0.35 ? '心情不错' : n.mood < -0.25 ? '有点糟' : '平静';
      return `${n.def.name}：${moodWord}，信任 ${Math.round(n.trust * 100)}%${m ? `，记得「${m.topic}」` : ''}`;
    }
  };
}