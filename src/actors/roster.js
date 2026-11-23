// The cast. Eight residents stand in the streets around the central crossing, plus the
// player.
//
// `mood` and `links` are not decoration: the conversation system that comes next reads
// them to decide how one character's mood spills into what the others say.

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
    links: { 'npc-bluecat': 'friend', 'npc-fan': 'acquaintance' },
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
    links: { 'npc-maid': 'acquaintance', 'npc-dragon': 'sibling' },
    bobPhase: 2.3
  },
  {
    id: 'npc-goth', name: '墨', role: '哥特',
    x: -7.8, z: 15, yaw: Math.PI / 2, height: 1.68,
    accent: '#9d8cff', mood: 'guarded',
    line: '别站在灯下面。光会把你照得太清楚。',
    links: { 'npc-vampire': 'old-friend', 'npc-bluecat': 'stranger' },
    bobPhase: 3.4
  },
  {
    id: 'npc-kpiano', name: '月', role: '琴师',
    x: -7.8, z: 32, yaw: Math.PI / 2, height: 1.62,
    accent: '#c9d8ff', mood: 'distant',
    line: '刚练完一段。现在耳朵里还留着声音。',
    links: { 'npc-bluecat': 'rival', 'npc-fan': 'friend' },
    bobPhase: 4.5
  },
  {
    id: 'npc-dragon', name: '白', role: '龙角',
    x: 15, z: -7.8, yaw: 0, height: 1.84,
    accent: '#ffe3a8', mood: 'watchful',
    line: '这栋楼比我上次来的时候又高了两层。人类真闲。',
    links: { 'npc-fan': 'sibling', 'npc-mermaid': 'friend' },
    bobPhase: 5.2
  },
  {
    id: 'npc-vampire', name: '绯', role: '血族',
    x: -15, z: -7.8, yaw: 0, height: 1.76,
    accent: '#ff9aa8', mood: 'amused',
    line: '这个点的太阳，连我的影子都懒得跟。',
    links: { 'npc-goth': 'old-friend', 'npc-maid': 'patron' },
    bobPhase: 0.7
  },
  {
    id: 'npc-mermaid', name: '汐', role: '人鱼',
    x: 7.8, z: -15, yaw: -Math.PI / 2, height: 1.70,
    accent: '#8fe0ff', mood: 'curious',
    line: '陆地上的风是干的。很奇怪吧。',
    links: { 'npc-dragon': 'friend', 'npc-kpiano': 'stranger' },
    bobPhase: 1.9
  }
];

export const ALL = [PLAYER, ...NPCS];