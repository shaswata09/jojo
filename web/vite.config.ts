import path from 'node:path'
// `vitest/config` rather than `vite`: it is the same `defineConfig` widened to
// accept the `test` block below. Imported from 'vite', `test` is an excess
// property and the config fails to typecheck.
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFile } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import type { Plugin } from 'vite'

// https://vite.dev/config/
/**
 * Where the built app will be served from.
 *
 * '/' everywhere except GitHub Pages, which serves a project site under the
 * repository name — so the deploy workflow sets `BASE_PATH=/jojo/` and every
 * asset URL Vite writes is rewritten to match. An env var rather than a
 * literal, because the repository name is deployment configuration and not a
 * fact about this code: a custom domain, or a fork under another name, needs a
 * different value and no code change.
 *
 * `App.tsx` reads the same value back through `import.meta.env.BASE_URL` for
 * the router's basename. One source, so the two cannot disagree.
 */
const base = process.env.BASE_PATH ?? '/'

/**
 * Keeps the Settings page's extension download no older than the extension.
 *
 * `npm run dev` packs `extension/` into `public/jojo-extension.zip` once, before
 * Vite starts, and nothing packed it again — so an extension changed while the
 * dev server ran was served as the OLD zip. Measured 2026-09-11: the zip was
 * built at 11:55, a fix to `background.js` landed at 12:06, and a copy unzipped
 * from Settings went on failing after every Reload, because Reload re-reads the
 * same stale folder.
 *
 * Checked when the zip is ASKED FOR rather than on every save, so editing the
 * extension does not reload the app each time the zip is rewritten: a download
 * whose sources are newer than it is repacked first, and a current one is served
 * as it is. Dev only — `npm run build` packs before it bundles.
 *
 * SERVED HERE, not handed back to Vite. The pack deletes the old zip before it
 * writes the new one, and Vite's list of public files follows its file watcher,
 * which lags: handed on straight after a repack, 3 of 25 downloads came back as
 * the app's index.html — a 200 that was not a zip — because for that moment Vite
 * believed the file did not exist and fell through to the SPA fallback. A corrupt
 * download is worse than a stale one, so the file is streamed from disk here,
 * where it is known to be complete.
 */
function freshExtensionZip(): Plugin {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const extension = path.join(here, 'extension')
  const zip = path.join(here, 'public', 'jojo-extension.zip')
  const newest = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce((latest, entry) => {
      const full = path.join(dir, entry.name)
      return Math.max(latest, entry.isDirectory() ? newest(full) : statSync(full).mtimeMs)
    }, 0)
  const pack = () =>
    new Promise<void>((resolve) => {
      execFile(
        process.execPath,
        [path.join(here, 'scripts', 'pack-extension.mjs'), '--optional'],
        { cwd: here },
        () => {
          resolve()
        },
      )
    })
  return {
    name: 'jojo:fresh-extension-zip',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? '').split('?')[0]?.endsWith('/jojo-extension.zip')) {
          next()
          return
        }
        const serve = () => {
          // A pack that failed leaves nothing to send: let Vite answer as usual.
          if (!existsSync(zip)) {
            next()
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/zip')
          res.setHeader('Content-Length', String(statSync(zip).size))
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          createReadStream(zip).pipe(res)
        }
        const stale = !existsSync(zip) || newest(extension) > statSync(zip).mtimeMs
        if (stale) void pack().then(serve)
        else serve()
      })
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), freshExtensionZip()],
  /*
   * `.env` lives at the REPO ROOT, not in `web/`.
   *
   * Vite's default is its own root, which is this directory — and that would put
   * the Firebase config and the two reporting flags inside the web workspace,
   * where the phone build cannot see them and where a second copy would appear
   * the first time somebody needed one of the same values elsewhere. One file at
   * the top, gitignored, listed in `.env.example`.
   *
   * The VITE_ prefix rule still applies and is the safety mechanism: anything in
   * that file without the prefix is not exposed to the bundle at all.
   */
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  /**
   * A same-origin path to MarkItDown, because a browser cannot reach it directly.
   *
   * `markitdown-mcp` sends no CORS headers and answers the preflight with 405 —
   * measured against 0.0.1a4, not assumed — so a page on one port cannot POST to
   * it on another however local both are. React Native has no such rule, which
   * is why the phone talks to it straight and only the web needs this.
   *
   * The proxy is the dev server's, so it is the dev story. A built copy of jojo
   * needs the same path served by whatever is serving the app; the Settings card
   * says so rather than leaving someone to discover it from an opaque
   * `TypeError`.
   */
  server: {
    proxy: {
      '/reader': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (at) => at.replace(/^\/reader/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
    /*
     * One React in the bundle, and under the workspace this has to be said.
     *
     * `mobile/` pins react 19.1.0 (Expo 54 / RN 0.81) and this app needs
     * >=19.2.7 for react-router, so the two genuinely cannot meet — npm hoists
     * mobile's copy to the root and nests web's. That is correct, and harmless
     * only for as long as nothing pulls the hoisted one into THIS bundle.
     *
     * `@jojo/service/react` is what changed the risk: it lives outside this
     * package and resolves its own `react`, so without deduping, a shared hook
     * and the component calling it could hold different React instances — which
     * surfaces as "invalid hook call" or, worse, two separate dispatchers with
     * silently unshared context.
     *
     * `tsconfig.app.json` pins the TYPE side through `paths` for the same
     * reason; this is the runtime half of that pair.
     */
    dedupe: ['react', 'react-dom'],
  },
  /**
   * Vitest reads this file, so the `@/` alias above is the one the tests get —
   * there is no second copy to keep in step.
   *
   * `environment: 'node'` because nothing under test renders. The graph, the
   * reducer and the whole of `src/kg` are plain functions, and jsdom would cost
   * seconds of startup per run to provide a DOM none of them touch. A test that
   * needs IndexedDB imports `fake-indexeddb/auto` itself rather than paying for
   * a browser-shaped environment globally.
   */
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * Only so that `import css from '@/index.css?raw'` returns the stylesheet.
     *
     * Vitest stubs every id matching `.css` with an empty module by default,
     * and it matches on the id, so the `?raw` query does not escape it — the
     * import silently yields `''`. A test that reads an empty stylesheet finds
     * no tokens and no selectors, and then passes, which is the failure mode
     * this whole test suite exists to avoid.
     *
     * The cost is nil: no test imports a stylesheet for its styles, and the one
     * that reads `index.css` reads it as text. Turning this on does not put a
     * DOM anywhere — `environment` above is still `node`.
     */
    css: true,
  },
})
