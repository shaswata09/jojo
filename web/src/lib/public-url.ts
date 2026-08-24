/**
 * The URL of a file vendored into `public/`, under whatever base we are served from.
 *
 * WHY THIS EXISTS. Vite rewrites the asset URLs it can SEE — imports, `url()`
 * in CSS, `src`/`href` in `index.html` — with the configured `base`. A path
 * written as a string in TypeScript is not one of those: it is just a string,
 * and it ships verbatim.
 *
 * That is invisible in development, where `base` is `/` and a root-absolute
 * path is correct. It only breaks where the app is served from a subpath, which
 * is exactly where nobody is looking: GitHub Pages publishes this at
 * `/<repo>/`, so `'/mascot.splinecode'` asked for
 * `github.io/mascot.splinecode` and got a 404. The 3D robot silently became the
 * 2D one, which is a fallback doing its job and therefore says nothing.
 *
 * `App.tsx` already reads `import.meta.env.BASE_URL` for the router's basename;
 * this is the same value for the same reason, so the two cannot disagree. Vite
 * substitutes it at build time, so the built bundle carries the literal
 * `/jojo/…` rather than computing anything at runtime.
 *
 * Use it for everything under `public/`. Anything that can be `import`ed
 * instead should be — an import goes through the asset pipeline, gets hashed
 * and gets rewritten for free. `public/` is for the files that cannot: the
 * Spline scene and its wasm, whose paths are handed to a third-party runtime,
 * and the packed extension, which has to keep a stable download name.
 */
export function publicUrl(path: string): string {
  // `BASE_URL` always ends in a slash — '/' in dev, '/jojo/' on Pages — so the
  // leading slash on the argument is stripped rather than doubled.
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
