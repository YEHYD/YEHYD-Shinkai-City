// The cast. Fifteen residents stand in the streets around the central crossing, plus the
// player.
//
// `mood` and `links` are not decoration: the conversation system reads them to decide how
// one character's mood spills into what the others say. Links are one-directional — the
// walker only travels the edge that is written down — so a pair that should gossip both
// ways needs an entry on both sides.
//
// The first eight were hand-drawn as front/side/back sheets; the seven after them came in
// through `tools/import-character-sheet.py` from `素材/`.

export const PLAYER = {
  id: 'player',
  name: '旅人',
  height: 1.74,
  spawn: { x: 0, z: 0, yaw: 0 }
};

export const NPCS = [
  {
    id: 'npc-maid', name: '铃', role: '女仆',
    x: 7.8, z: 14, yaw: -Math.PI / 2, height: 1.58,
    accent: '#d8c8ff', mood: 'calm',
    line: '欢迎回来。今天街上的风，比平时暖一点。',
    links: {
      'npc-bluecat': 'friend', 'npc-fan': 'acquaintance',
      'npc-lotus': 'friend', 'npc-haze': 'acquaintance'
    },
    bobPhase: 0.0
  },
  {
    id: 'npc-bluecat', name: '蓝', role: '猫耳',
    x: 7.8, z: 30, yaw: -Math.PI / 2, height: 1.60,
    accent: '#8fb4ff', mood: 'curious',
    line: '你走路的声音……和别人不一样。',
    links: { 'npc-maid': 'friend', 'npc-kpiano': 'rival' },
    bobPhase: 1.1
  },
  {
    id: 'npc-fan', name: '青', role: '执扇',
    x: 16, z: 7.8, yaw: Math.PI, height: 1.66,
    accent: '#7fdcc8', mood: 'composed',
    line: '这条街在傍晚最好看。灯一盏一盏亮起来的时候。',
    links: { 'npc-maid': 'acquaintance', 'npc-dragon': 'sibling', 'npc-haze': 'friend' },
    bobPhase: 2.3
  },
  {
    id: 'npc-goth', name: '墨', role: '哥特',
    x: -7.8, z: 15, yaw: Math.PI / 2, height: 1.68,
    accent: '#9d8cff', mood: 'guarded',
    line: '别站在灯下面。光会把你照得太清楚。',
    links: {
      'npc-vampire': 'old-friend', 'npc-bluecat': 'stranger',
      'npc-inkstone': 'acquaintance'
    },
    bobPhase: 3.4
  },
  {
    id: 'npc-kpiano', name: '月', role: '琴师',
    x: -7.8, z: 32, yaw: Math.PI / 2, height: 1.62,
    accent: '#c9d8ff', mood: 'distant',
    line: '刚练完一段。现在耳朵里还留着声音。',
    links: {
      'npc-bluecat': 'rival', 'npc-fan': 'friend',
      'npc-inkstone': 'friend', 'npc-amber': 'friend'
    },
    bobPhase: 4.5
  },
  {
    id: 'npc-dragon', name: '白', role: '龙角',
    x: 15, z: -7.8, yaw: 0, height: 1.84,
    accent: '#ffe3a8', mood: 'watchful',
    line: '这栋楼比我上次来的时候又高了两层。人类真闲。',
    links: { 'npc-fan': 'sibling', 'npc-mermaid': 'friend', 'npc-scorch': 'patron' },
    bobPhase: 5.2
  },
  {
    id: 'npc-vampire', name: '绯', role: '血族',
    x: -15, z: -7.8, yaw: 0, height: 1.76,
    accent: '#ff9aa8', mood: 'amused',
    line: '这个点的太阳，连我的影子都懒得跟。',
    links: {
      'npc-goth': 'old-friend', 'npc-maid': 'patron',
      'npc-scorch': 'old-friend', 'npc-amber': 'patron'
    },
    bobPhase: 0.7
  },
  {
    id: 'npc-mermaid', name: '汐', role: '人鱼',
    x: 7.8, z: -15, yaw: -Math.PI / 2, height: 1.70,
    accent: '#8fe0ff', mood: 'curious',
    line: '陆地上的风是干的。很奇怪吧。',
    links: {
      'npc-dragon': 'friend', 'npc-kpiano': 'stranger',
      'npc-mio': 'friend', 'npc-yuki': 'friend'
    },
    bobPhase: 1.9
  },
  {
    id: 'npc-lotus', name: '荷', role: '花匠',
    x: 7.8, z: 66, yaw: -Math.PI / 2, height: 1.62,
    accent: '#cfe6e0', mood: 'composed',
    line: '这些花是替你养的。你不知道吧。',
    links: { 'npc-maid': 'friend', 'npc-haze': 'acquaintance' },
    bobPhase: 2.7
  },
  {
    id: 'npc-inkstone', name: '砚', role: '书商',
    x: -7.8, z: 70, yaw: Math.PI / 2, height: 1.70,
    accent: '#9aa3b5', mood: 'guarded',
    line: '第三层有一本没有名字的书。别翻。',
    links: {
      'npc-goth': 'acquaintance', 'npc-kpiano': 'friend', 'npc-amber': 'rival'
    },
    bobPhase: 3.9
  },
  {
    id: 'npc-mio', name: '澪', role: '摆渡',
    x: -7.8, z: -34, yaw: Math.PI / 2, height: 1.66,
    accent: '#8fbdb8', mood: 'distant',
    line: '水退下去的时候，这条路会变成河。',
    links: { 'npc-mermaid': 'friend', 'npc-vampire': 'stranger' },
    bobPhase: 5.6
  },
  {
    id: 'npc-yuki', name: '雪', role: '信使',
    x: 7.8, z: -66, yaw: -Math.PI / 2, height: 1.60,
    accent: '#c6e6ff', mood: 'calm',
    line: '有你的信。寄信的人没写名字。',
    links: { 'npc-mermaid': 'friend', 'npc-maid': 'acquaintance' },
    bobPhase: 6.8
  },
  {
    id: 'npc-scorch', name: '灼', role: '铁匠',
    x: -66, z: 7.8, yaw: Math.PI, height: 1.78,
    accent: '#ff9b7a', mood: 'watchful',
    line: '铁冷下来的时候会响。你听见了吗。',
    links: { 'npc-dragon': 'patron', 'npc-vampire': 'old-friend' },
    bobPhase: 8.1
  },
  {
    id: 'npc-haze', name: '霞', role: '暗房',
    x: 66, z: -7.8, yaw: 0, height: 1.64,
    accent: '#ffb684', mood: 'curious',
    line: '这个时间的颜色，我留不住，只能记着。',
    links: { 'npc-fan': 'friend', 'npc-maid': 'acquaintance', 'npc-lotus': 'acquaintance' },
    bobPhase: 9.4
  },
  {
    id: 'npc-amber', name: '珀', role: '调酒',
    x: -7.8, z: 88, yaw: Math.PI / 2, height: 1.72,
    accent: '#ffd79a', mood: 'amused',
    line: '杯子我先温过了。坐吧。',
    links: {
      'npc-vampire': 'patron', 'npc-kpiano': 'friend', 'npc-inkstone': 'rival'
    },
    bobPhase: 10.6
  }
];

export const ALL = [PLAYER, ...NPCS];