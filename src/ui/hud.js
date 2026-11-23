// Head-up display. All DOM writes are guarded so a steady scene does not thrash layout.

const $ = id => document.getElementById(id);

export function createHud() {
  const el = {
    clock: $('clock'),
    phase: $('phase'),
    district: $('district'),
    fps: $('fps'),
    pos: $('pos'),
    drawcalls: $('drawcalls'),
    npccount: $('npccount'),
    focus: $('focus'),
    focusWho: document.querySelector('#focus .who'),
    boot: $('boot'),
    bar: document.querySelector('#bar i'),
    bootmsg: $('bootmsg')
  };

  const prev = {};
  const set = (key, node, text) => {
    if (!node || prev[key] === text) return;
    prev[key] = text;
    node.textContent = text;
  };

  let focusOn = false;

  return {
    boot(p, msg) {
      if (el.bar) el.bar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
      if (msg) set('bootmsg', el.bootmsg, msg);
    },

    ready() {
      el.boot?.classList.add('gone');
      setTimeout(() => { if (el.boot) el.boot.style.display = 'none'; }, 900);
    },

    update({ clock, phase, district, fps, x, z, drawcalls, npcCount }) {
      set('clock', el.clock, clock);
      set('phase', el.phase, phase);
      set('district', el.district, district);
      set('fps', el.fps, String(Math.round(fps)));
      set('pos', el.pos, `${x.toFixed(0)}, ${z.toFixed(0)}`);
      if (el.drawcalls) set('drawcalls', el.drawcalls, String(drawcalls));
      if (el.npccount) set('npccount', el.npccount, String(npcCount));
    },

    focus(name) {
      const on = !!name;
      if (on !== focusOn) {
        focusOn = on;
        el.focus?.classList.toggle('on', on);
      }
      if (on) set('focusWho', el.focusWho, name);
    }
  };
}