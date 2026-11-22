/**
 * L1 — where jojo's privacy notice lives, said once for every app.
 *
 * WHY A CONSTANT IN CORE. The notice is linked from the web app's consent step
 * and Settings, from the phone's consent sheet and Settings, and from the
 * extension. Five places spelling one address is five places for it to drift,
 * and a privacy link that 404s is worse than none: it looks like a notice was
 * offered and hides that it was not. Core is the one layer all three import.
 *
 * WHY TWO SPELLINGS. The web app is served from a path that depends on where
 * it is deployed — GitHub Pages puts it under `/jojo/`, a fork's preview
 * under its own name, `vite dev` at `/`. So the web joins `PRIVACY_PAGE` onto
 * its own `import.meta.env.BASE_URL` and the link always points at the copy of
 * the notice that shipped with that copy of the app (`web/public/privacy.html`,
 * copied to the build root by Vite). The phone and the extension have no page
 * of their own to resolve against, so they open `PRIVACY_URL`, the published
 * copy.
 *
 * NO NETWORK HERE, as everywhere in core: these are strings. Opening one is the
 * app shell's job.
 */

/** The notice's file name, relative to the web app's base URL. */
export const PRIVACY_PAGE = 'privacy.html'

/** The published notice, for apps with no base URL of their own to resolve against. */
export const PRIVACY_URL = 'https://shaswata09.github.io/jojo/privacy.html'
