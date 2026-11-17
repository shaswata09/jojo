/**
 * Which pages the PACKED extension's bridge runs on (review 2, security-1).
 *
 * `content_scripts.matches` is the bridge's whole security boundary (see the
 * header of `extension/bridge.js`). The checked-in manifest is the DEVELOPMENT
 * build — loaded unpacked from `web/extension/` — and it names Vite's dev and
 * preview ports on localhost so a developer's own server can reach it. Those
 * are the ports every other Vite project uses too, and a page on any of them
 * could post one message and have the extension open a site in the person's
 * signed-in browser and hand back its HTML, or read and empty the capture
 * queue. So the zip the app hands to everyone ships without them: only the
 * deployed origin, and `JOJO_APP_ORIGIN` when a fork is served from somewhere
 * else.
 *
 * A dev pack keeps them: `npm run dev` packs with `--dev`, and so does the dev
 * server when it repacks a stale zip, because a developer installing from their
 * own dev server needs exactly those ports. `JOJO_PACK_DEV=1` does the same
 * from the environment.
 */

/** A match pattern for this machine — a dev or preview server. */
export const isDevMatch = (pattern) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(pattern)

/**
 * The match list a pack ships: the dev entries dropped unless `dev`, and
 * `origin` added as `${origin}/*` — never a bare origin, which Chrome rejects
 * along with the whole `content_scripts` block.
 */
export function shippedMatches(matches, { dev = false, origin = '' } = {}) {
  const out = dev ? [...matches] : matches.filter((pattern) => !isDevMatch(pattern))
  const extra = origin.trim()
  if (extra) {
    const pattern = `${extra.replace(/\/+$/, '')}/*`
    if (!out.includes(pattern)) out.push(pattern)
  }
  return out
}

/** Whether this pack is a development one: `--dev`, or `JOJO_PACK_DEV=1`. */
export const isDevPack = (argv, env) => argv.includes('--dev') || env.JOJO_PACK_DEV === '1'
