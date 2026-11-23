// Turning the social state into something the player can actually read.
//
// No model call, but the shape is the same one an LLM would get: who am I, how do I feel
// about you, what have I heard about you and from whom. The reply is assembled from those
// three, so the same question gets a different answer once the street has had time to talk.

const TOPICS = {
  warm: { topic: '你对人说话很温和', tone: 1.0 },
  curious: { topic: '你很爱打听这条街的事', tone: 0.25 },
  cold: { topic: '你不太想和人说话', tone: -1.0 }
};

const OPTIONS = [
  { tag: 'warm', label: '「今天的天空，你会拍下来吗？」' },
  { tag: 'curious', label: '「这条街上，最近有什么不对劲的事？」' },
  { tag: 'cold', label: '「我只是路过。」' }
];

// Mood bands change how someone responds to the same words.
const band = mood => (mood > 0.4 ? 'good' : mood < -0.2 ? 'bad' : 'flat');

const REPLIES = {
  warm: {
    good: [
      '「会。而且我会站在同一个地方拍，直到云走完。」',
      '「拍下来也留不住啊。不过……你说的对，还是想拍。」'
    ],
    flat: [
      '「天空啊。我倒是没怎么抬头看过。」',
      '「这儿的天色一天一个样。看久了会舍不得走。」'
    ],
    bad: [
      '「……没那个心情。」',
      '「你要是真觉得好看，就多站一会儿吧。」'
    ]
  },
  curious: {
    good: [
      '「有。不过你要是问出来了，别说是我讲的。」',
      '「巷子尽头那家店，灯整夜不灭。没人知道在做什么。」'
    ],
    flat: [
      '「不对劲的事天天有。看你想听哪一件。」',
      '「这条街安静太久了，安静本身就是件怪事。」'
    ],
    bad: [
      '「问了也不一定有人愿意答。」',
      '「你要是只想找话题，去问别人吧。」'
    ]
  },
  cold: {
    good: [
      '「嗯。路过也挺好。」',
      '「随你。不过风大，别站太久。」'
    ],
    flat: [
      '「……」',
      '「是吗。」'
    ],
    bad: [
      '「那你就路过吧。」',
      '「行。省得我再解释一遍。」'
    ]
  }
};

const HEARD = {
  good: [
    v => `「${v}说你是个不难说话的人。」`,
    v => `「${v}提过你。说你还挺会挑话头。」`
  ],
  bad: [
    v => `「${v}说你问话的样子像在查户口。」`,
    v => `「${v}让我别跟你多聊。我倒想自己看看。」`
  ],
  flat: [
    v => `「${v}提起过你。说你在这条街上转了很久。」`,
    v => `「${v}说这两天见过你。原来就是你。」`
  ]
};

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export function createDialogue(social) {
  let active = null;

  function opener(node) {
    const memory = social.topMemory(node.id, 0.28);
    if (memory && memory.from !== node.id && memory.weight > 0.30) {
      const via = social.nameOf(memory.from);
      const b = memory.tone > 0.3 ? 'good' : memory.tone < -0.2 ? 'bad' : 'flat';
      return pick(HEARD[b])(via);
    }
    if (node.talkedTo === 0) return `「${node.def.line}」`;
    if (node.trust > 0.62) return pick(['「又见面了。」', '「你回来了。」', '「今天走得比昨天慢。」']);
    if (node.trust < 0.28) return pick(['「……有事？」', '「你挡着光了。」']);
    return pick(['「嗯。」', '「今天也在走？」', '「这条街走不腻吗。」']);
  }

  return {
    get active() { return active; },

    begin(npcId) {
      const node = social.nodes.get(npcId);
      if (!node) return null;
      active = {
        npcId,
        name: node.def.name,
        role: node.def.role,
        accent: node.def.accent,
        mood: node.mood,
        trust: node.trust,
        text: opener(node),
        options: OPTIONS.map(o => ({ ...o })),
        done: false,
        round: 0
      };
      return active;
    },

    /** Apply a choice and return the reply text. */
    choose(index) {
      if (!active || active.done) return null;
      const opt = active.options[index];
      if (!opt) return null;
      const node = social.nodes.get(active.npcId);
      const t = TOPICS[opt.tag];

      social.speak(active.npcId, { topic: t.topic, tone: t.tone, text: opt.label });

      const mood = band(node.mood);
      let reply = pick(REPLIES[opt.tag][mood]);

      // Occasionally let them pull a neighbour into it — this is what makes the street
      // feel like it has people in it rather than one NPC at a time.
      const ns = social.neighbours(node.id);
      if (ns.length && Math.random() < 0.55) {
        const otherId = ns[Math.floor(Math.random() * ns.length)];
        const other = social.nodes.get(otherId);
        if (other) {
          const kind = node.edges[otherId];
          const lead = kind === 'rival' ? '别跟' : kind === 'sibling' ? '我兄妹' : '你还没见过';
          const tail = kind === 'rival'
            ? `${other.def.name}提这事。他会记仇。`
            : kind === 'sibling'
              ? `${other.def.name}吧？他去那边了。`
              : `${other.def.name}吗？就在这附近。`;
          reply += `\n${lead}${tail}`;
        }
      }

      active.round++;
      active.done = true;
      active.text = reply;
      active.options = [{ tag: 'end', label: '（结束对话）' }];
      return reply;
    },

    end() {
      active = null;
    },

    /** For the debug console: what does everyone currently believe? */
    snapshot() {
      return [...social.nodes.keys()].map(id => social.describe(id));
    }
  };
}