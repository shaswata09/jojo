/**
 * Copies `dist/index.html` to `dist/404.html`.
 *
 * A static host serves a file per path. This app has no files at
 * `/applications/rice` — it has one HTML document and a router that reads the
 * URL — so every deep link, every refresh on a record, and every bookmark
 * anyone saves is a request for a path the host has never heard of.
 *
 * GitHub Pages answers those with `404.html` if one exists, and — this is the
 * part that makes the trick work rather than merely soften it — it serves that
 * file WITHOUT rewriting the URL. The browser still has the path it asked for,
 * the router reads it out of `location`, and the right page renders. The status
 * line says 404 and the page is correct, which is a trade every SPA on a static
 * host makes.
 *
 * Done in the build rather than in the deploy workflow so that `npm run build`
 * produces a directory that actually works when served statically. A fallback
 * that exists only inside CI is a fallback nobody can reproduce the day it
 * stops working.
 *
 * If this app ever moves to a host with real rewrite rules — Netlify, Cloudflare
 * Pages, an nginx `try_files` — delete this and configure the rewrite there
 * instead. A 200 beats a 404 that happens to render.
 */

import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(WEB, 'dist')
const index = join(dist, 'index.html')

if (!existsSync(index)) {
  console.error(
    'spa-fallback: no dist/index.html.\n' +
      '  This runs after `vite build`, so if the build failed the error above is\n' +
      '  the real one. Nothing was copied.',
  )
  process.exit(1)
}

copyFileSync(index, join(dist, '404.html'))
console.log('spa-fallback: dist/404.html written from dist/index.html')
