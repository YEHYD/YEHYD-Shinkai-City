// The conversation panel.
//
// Deliberately a plain DOM overlay rather than anything drawn in WebGL: text stays crisp
// at any resolution, it is selectable, and it does not cost a draw call.

const CHAR_DELAY = 18;   // ms per character — fast enough not to annoy, slow enough to read as speech

export function createDialoguePanel({ onChoose, faceSrc }) {
  const root = document.createElement('div');
  root.id = 'talk';
  root.innerHTML = `
    <div class="talk-card">
      <div class="talk-face"></div>
      <div class="talk-main">
        <div class="talk-name"></div>
        <div class="talk-text"></div>
        <div class="talk-options"></div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const face = root.querySelector('.talk-face');
  const nameEl = root.querySelector('.talk-name');
  const textEl = root.querySelector('.talk-text');
  const optsEl = root.querySelector('.talk-options');

  let full = '';
  let shown = 0;
  let timer = 0;
  let typing = false;
  let current = null;

  function finishTyping() {
    if (!typing) return;
    typing = false;
    clearInterval(timer);
    textEl.textContent = full;
    optsEl.classList.add('in');
    optsEl.querySelectorAll('button')[0]?.focus();
  }

  function type(text) {
    full = text;
    shown = 0;
    typing = true;
    textEl.textContent = '';
    optsEl.classList.remove('in');
    clearInterval(timer);
    timer = setInterval(() => {
      shown += 1;
      // Reveal in small bursts so long lines do not crawl.
      textEl.textContent = full.slice(0, shown);
      if (shown >= full.length) finishTyping();
    }, CHAR_DELAY);
  }

  function setOptions(options) {
    optsEl.innerHTML = '';
    options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<i>${i + 1}</i>${opt.label}`;
      if (opt.tag === 'end') b.classList.add('end');
      b.addEventListener('click', () => {
        if (typing) { finishTyping(); return; }
        onChoose(i);
      });
      optsEl.appendChild(b);
    });
  }

  root.addEventListener('pointerdown', e => {
    if (typing) { e.preventDefault(); finishTyping(); }
  });

  return {
    get open() { return current !== null; },
    get typing() { return typing; },

    show(conv) {
      current = conv;
      // A warm character glows warm; someone who has gone cold reads cool, so the
      // player can feel the relationship without opening a stats page.
      const accent = conv.mood < -0.15 ? '#9fc0e8' : (conv.accent || '#ffe3b8');
      root.classList.add('on');
      nameEl.innerHTML = `${conv.name}<span>${conv.role}</span>`;
      nameEl.style.setProperty('--accent', accent);
      // The portrait has to come through faceSrc: in the single-file build the drawing is a
      // data: URL, and a hard-coded ./assets/... path would 404 on a file:// page.
      const portrait = faceSrc ? faceSrc(conv.npcId) : `./assets/characters/${conv.npcId}/front.webp`;
      face.style.backgroundImage = `url("${portrait}")`;
      face.style.setProperty('--accent', accent);
      setOptions(conv.options);
      type(conv.text);
    },

    /** Replace the body text (the NPC's reply) without closing the panel. */
    replace(conv) {
      current = conv;
      setOptions(conv.options);
      type(conv.text);
    },

    skip: finishTyping,

    close() {
      current = null;
      typing = false;
      clearInterval(timer);
      root.classList.remove('on');
    }
  };
}