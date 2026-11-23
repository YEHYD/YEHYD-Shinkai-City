// Build a single double-clickable HTML file for demoing without any dev environment.
//
// The dev tree runs as plain ES modules over HTTP. A file:// page cannot do that:
// module imports and fetch() are both blocked by CORS there. So this build:
//   1. bundles every module (ours + vendor/three + the addons we use) into one script,
//   2. inlines the character drawings as data: URLs (no fetch, no loose files),
//   3. writes one .html that contains the whole thing — style, sprites, code.
//
// Usage: node tools/build-single.mjs [--out dist/Shinkai-City.html]

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(ROOT, argOf('out', join('dist', 'index.html')));

const log = (...a) => console.log('[build]', ...a);
const kb = n => `${(n / 1024).toFixed(0)} KB`;

// ---------------------------------------------------------------- 1. bundle the JS
// esbuild is not an npm dependency (this machine cannot run install scripts), so it is
// looked up as a plain binary: $ESBUILD, tools/esbuild.exe, or esbuild on PATH.
const ESBUILD = [
  process.env.ESBUILD,
  join(ROOT, 'tools', process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'),
  'esbuild'
].filter(Boolean).find(p => p === 'esbuild' || existsSync(p));

if (!ESBUILD) {
  console.error('[build] esbuild not found. Set ESBUILD=/path/to/esbuild or drop it in tools/.');
  process.exit(1);
}

const bundlePath = join(ROOT, '.tmp', 'app.bundle.js');
await mkdir(dirname(bundlePath), { recursive: true });

const esbuild = spawnSync(ESBUILD, [
  join(ROOT, 'src', 'main.js'),
  '--bundle',
  '--format=esm',
  '--target=chrome110',
  '--minify',
  '--legal-comments=none',
  // The importmap is a browser feature; esbuild needs the same mapping as file paths.
  `--alias:three=${join(ROOT, 'vendor', 'three', 'three.module.js')}`,
  `--alias:three/addons=${join(ROOT, 'vendor', 'three', 'addons')}`,
  `--outfile=${bundlePath}`
], { stdio: 'inherit', cwd: ROOT });

if (esbuild.status !== 0) {
  console.error('[build] esbuild failed with', esbuild.status);
  process.exit(esbuild.status ?? 1);
}

let js = await readFile(bundlePath, 'utf8');
js = js.replace(/<\/script/gi, '<\\/script');   // would close the inline tag early

// ---------------------------------------------------------------- 2. inline the sprites
const charDir = join(ROOT, 'assets', 'characters');
const manifest = JSON.parse(await readFile(join(charDir, 'manifest.json'), 'utf8'));

const files = {};
for (const id of Object.keys(manifest)) {
  for (const view of Object.keys(manifest[id].views)) {
    const p = join(charDir, id, `${view}.webp`);
    if (!existsSync(p)) continue;
    const buf = await readFile(p);
    files[`${id}/${view}`] = `data:image/webp;base64,${buf.toString('base64')}`;
  }
}

const assetsScript = `<script>window.__SHINKAI_ASSETS=${JSON.stringify({ manifest, files })};</script>`;
log('sprites inlined:', Object.keys(files).length, 'files,', kb(Buffer.byteLength(assetsScript)));

// ---------------------------------------------------------------- 3. assemble the page
let html = await readFile(join(ROOT, 'index.html'), 'utf8');

// Drop the importmap: everything it resolved is already in the bundle.
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, () => '');
// Swap the entry module for the bundle + the inlined assets. The replacement is a
// function on purpose: minified code is full of `$&` / `` $` `` sequences, and a plain
// string replacement would expand them into copies of the matched tag.
html = html.replace(
  /<script type="module" src="\.\/src\/main\.js"><\/script>/,
  () => `${assetsScript}\n<script type="module">\n${js}\n</script>`
);

if (!html.includes('__SHINKAI_ASSETS')) {
  console.error('[build] could not find the entry <script> in index.html — did the tag change?');
  process.exit(1);
}

html = html.replace('<title>Shinkai City</title>', '<title>Shinkai City</title>\n<meta name="color-scheme" content="dark">');

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html, 'utf8');

const info = await stat(OUT);
log('wrote', relative(ROOT, OUT), kb(info.size));
log('double-click it, or open the file in Chrome/Edge — no server needed.');