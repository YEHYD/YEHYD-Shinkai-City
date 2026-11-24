// Tiny static server for local development.
//
// Two reasons this exists instead of `python -m http.server`:
//   1. ES modules and .webp/.hdr files need the right Content-Type, or the browser refuses
//      them under strict MIME checking.
//   2. Everything is served `no-store`. While tuning shaders you reload twenty times a
//      minute, and a silently cached old module wastes all of them.
//
// Usage: node tools/serve.mjs [--port 8123] [--root .] [--host 127.0.0.1]
// Pass `--host 0.0.0.0` inside a container so the port is reachable from outside.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(argOf('port', 8123));
const HOST = argOf('host', '127.0.0.1');
const ROOT = resolve(argOf('root', '.'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.hdr': 'image/vnd.radiance',
  '.ktx2': 'image/ktx2',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm'
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Refuse anything that escapes the root.
  const full = resolve(join(ROOT, normalize(pathname)));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(full);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: pathname.replace(/\/?$/, '/') + 'index.html' }).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store, must-revalidate'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(full).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] ${ROOT}`);
  console.log(`[serve] http://${HOST}:${PORT}/`);
});