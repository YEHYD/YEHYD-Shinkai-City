# Shinkai City — a static three.js scene served by the repo's own tiny server.
#
# The page is plain static files (an import map + ES modules + WebP sprites), so
# nothing has to be bundled: the image just ships the files the browser asks for
# and runs tools/serve.mjs on port 8192.
#
#   docker build -t shinkai-city .
#   docker run --rm -p 8192:8192 shinkai-city
#   -> http://localhost:8192/

FROM node:26.13.1-alpine3.24

WORKDIR /app

# The only knob: PORT flows into the CMD below. Keep EXPOSE in sync if you change it.
ENV NODE_ENV=production \
    PORT=8192

# Only the paths index.html actually loads: ./src/*.js, ./vendor/three/, ./assets/characters/.
# docs/ (the 6 MB single-file build), dist/, tools/esbuild and the raw art sources are
# excluded by .dockerignore — they are build artefacts, not runtime input.
COPY --chown=node:node index.html ./
COPY --chown=node:node src ./src
COPY --chown=node:node vendor ./vendor
COPY --chown=node:node assets ./assets
COPY --chown=node:node tools/serve.mjs ./tools/serve.mjs

# The server only reads; run it as the unprivileged image user.
USER node

EXPOSE 8192

# serve.mjs sends no-store, answers HEAD, and sets Content-Type for .webp/.hdr/.mjs —
# a bare `python -m http.server` would fail the module MIME check in the browser.
CMD ["sh", "-c", "exec node tools/serve.mjs --port \"$PORT\" --host 0.0.0.0"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/index.html" || exit 1