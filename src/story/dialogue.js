// Turning the social state into something the player can actually read.
//
// No model call, but the shape is the same one an LLM would get: who am I, how do I feel
// about you, what have I heard about you and from whom. The reply is assembled from those
// three, so the same question gets a different answer once the street has had time to talk.
//
// A conversation runs for three rounds, or four if the character already trusts you. Each
// round's options depend on what you picked last time, so the exchange actually follows the
// thread instead of offering the same three buttons.

import {
  INTENTS, REPLIES, VOICE, OPENS, FOLLOW, DEEPEN, LAST,
  HEARD, ASIDE, FAREWELL, band
} from './lines.js';
import { PERSONA, OPENS_BY_NPC } from './voices.js';

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export function createDialogue(social) {
  let active = null;
  // Lines already spoken in this conversation, so a long talk never repeats itself.
  let used = new Set();

  function take(pool) {
    const fresh = pool.filter(l => !used.has(l));
    const line = fresh.length ? pick(fresh) : pick(pool);
    used.add(line);
    return line;
  }

  function opener(node) {
    const memory = social.topMemory(node.id, 0.28);
    if (memory && memory.from !== node.id && memory.weight > 0.30) {
      const via = social.nameOf(memory.from);
      const b = memory.tone > 0.3 ? 'good' : memory.tone < -0.2 ? 'bad' : 'flat';
      return pick(HEARD[b])(via);
    }
    // Each resident has their own way in; the shared greetings are only the floor.
    const persona = PERSONA[node.id];
    if (node.talkedTo === 0) {
      const own = persona && persona.open;
      return own && own.length ? `「${take(own)}」` : `「${node.def.line}」`;
    }
    if (persona && persona.again && Math.random() < 0.65) {
      return `「${take(persona.again)}」`;
    }
    if (node.trust > 0.62) return pick(['「又见面了。」', '「你回来了。」', '「今天走得比昨天慢。」']);
    if (node.trust < 0.28) return pick(['「……有事？」', '「你挡着光了。」']);
    return pick(['「嗯。」', '「今天也在走？」', '「这条街走不腻吗。」']);
  }

  /** Round 0 is the way in; after that the options follow what you just said. */
  function optionsFor(round, prevTag, npcId) {
    if (round <= 0) {
      // Their own four ways in, so the buttons read like this person's street, not a form.
      const own = OPENS_BY_NPC[npcId] || OPENS;
      return own.filter(o => !used.has(o.label));
    }
    if (round === 1) return (FOLLOW[prevTag] || DEEPEN).filter(o => !used.has(o.label));
    if (round === 2) return DEEPEN.filter(o => !used.has(o.label));
    return LAST.filter(o => !used.has(o.label));
  }

  function nodeOf(id) {
    return social.nodes.get(id);
  }

  return {
    get active() { return active; },

    begin(npcId) {
      const node = nodeOf(npcId);
      if (!node) return null;
      used = new Set();
      const rounds = node.trust > 0.55 ? 4 : 3;
      active = {
        npcId,
        name: node.def.name,
        role: node.def.role,
        accent: node.def.accent,
        mood: node.mood,
        trust: node.trust,
        text: opener(node),
        options: optionsFor(0, null, npcId),
        done: false,
        round: 0,
        rounds
      };
      return active;
    },

    /** Apply a choice and return the reply text. */
    choose(index) {
      if (!active || active.done) return null;
      const opt = active.options[index];
      if (!opt || opt.tag === 'end') return null;
      const node = nodeOf(active.npcId);
      if (!node) return null;
      const intent = INTENTS[opt.tag] || INTENTS.warm;

      // What you say late in a conversation lands harder than small talk.
      const weight = active.round === 0 ? 1 : 1.15;
      const tone = Math.max(-1, Math.min(1, intent.tone * weight));
      social.speak(active.npcId, { topic: intent.topic, tone, text: opt.label });
      used.add(opt.label);

      const mood = band(node.mood);
      const depth = active.round === 0 ? 'light' : 'deep';
      // Their own answer first, the shared pool only when they have nothing of their own.
      const persona = PERSONA[node.id];
      const own = persona && persona.reply[opt.tag];
      let reply = own && own.length
        ? take([own[depth === 'deep' ? 1 : 0] || own[0]])
        : take(REPLIES[opt.tag][depth][mood]);

      // Splice in this character's own voice on follow-up rounds.
      const voice = VOICE[node.id];
      if (active.round >= 1 && voice && Math.random() < 0.55) {
        reply += `\n${take(voice)}`;
      }

      // Occasionally let them pull a neighbour into it — this is what makes the street
      // feel like it has people in it rather than one NPC at a time.
      const ns = social.neighbours(node.id);
      if (active.round >= 1 && ns.length && Math.random() < 0.5) {
        const otherId = ns[Math.floor(Math.random() * ns.length)];
        const other = social.nodes.get(otherId);
        if (other) {
          const kind = node.edges[otherId];
          if (Math.random() < 0.5) {
            const lead = kind === 'rival' ? '别跟' : kind === 'sibling' ? '我兄妹' : '你还没见过';
            const tail = kind === 'rival'
              ? `${other.def.name}提这事。他会记仇。`
              : kind === 'sibling'
                ? `${other.def.name}吧？他去那边了。`
                : `${other.def.name}吗？就在这附近。`;
            reply += `\n${lead}${tail}`;
          } else {
            reply += take(ASIDE[mood])(other.def.name);
          }
        }
      }

      active.round++;
      active.mood = node.mood;
      active.trust = node.trust;
      active.text = reply;

      if (active.round >= active.rounds) {
        active.done = true;
        const bye = PERSONA[node.id] && PERSONA[node.id].close;
        active.text += `\n${bye && bye.length ? take(bye) : take(FAREWELL[mood])}`;
        active.options = [{ tag: 'end', label: '（结束对话）' }];
      } else {
        const options = optionsFor(active.round, opt.tag, active.npcId);
        active.options = options.length ? options : [{ tag: 'end', label: '（结束对话）' }];
      }
      return reply;
    },

    end() {
      active = null;
      used = new Set();
    },

    /** For the debug console: what does everyone currently believe? */
    snapshot() {
      return [...social.nodes.keys()].map(id => social.describe(id));
    }
  };
}