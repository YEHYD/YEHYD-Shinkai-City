# Credits

## Code

The scene structure, the code that builds the city, the characters, the camera and the
dialogue system in `src/` are written for this project.

`src/scene/atmosphere.js` is a rewritten derivative of the atmosphere model in
**yans_little_town** v2.0 (MIT licensed). The colour key tables, the sun/moon arc timing
and the horizon/ground fog blend are adapted from it. Original: https://github.com/yans-labs

Per the MIT licence, that file keeps this notice at the top of its header comment.

`src/actors/people/` (appearance, build, body, pose, crowd, shapes, palette) is copied from
**yans_little_town** v2.0 (MIT licensed) — the 17-bone skinned pedestrian system used by the
walk-around demo in `demo/people.html`. Two shims were added for this project: `random.js`
(the FNV-1a hash those modules key their looks off) and `seats.js` (an empty seat table, since
bench poses are not authored here). The import paths were adjusted; the drawing and posing
logic is unchanged. Original: https://github.com/yans-labs

## Reference and inspiration

* **thousand-town (千人小镇)** by 仪绘士 / YiHuiShiBY — CC BY 4.0. Read for its approach to
  procedural street layout and its resident character kit. No code was copied from it.
* **yans_little_town** — MIT. The layered `core / render / ui` project structure and the
  importmap-based zero-build setup follow its conventions.

## Assets

Character sprites in `assets/characters/` were provided by the project owner. The first
nine came from `characters-src/` (pre-cut front/side/back PNGs); the seven newest came from
`素材/` as one three-view sheet each, keyed and split by `tools/import-character-sheet.py`.
All textures in `src/core/textures.js` (facades, ground, clouds, signs, glows) are generated
procedurally at runtime — apart from the character art there are no external image assets in
the scene.

## Runtime

* three.js r187 (MIT) — vendored in `vendor/three/`.
* Bundled addons: `Sky`, `OrbitControls`, `BufferGeometryUtils`, `EffectComposer` and the
  bloom/output passes, all from the three.js examples (MIT).