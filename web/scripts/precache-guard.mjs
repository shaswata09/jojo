/**
 * Whether a precache list would actually boot the app.
 *
 * Split out of `make-sw.mjs` because that script reads `dist/`, writes a file
 * and calls `process.exit`: none of it can be exercised without a real build.
 * This half is pure — it takes the document, the base path and the set of files
 * the worker would install, and returns the reasons that set is not enough.
 * `make-sw.mjs` turns those reasons into a failed build; the test beside it
 * turns them into assertions, so the guard itself is something that can fail on
 * purpose.
 *
 * Both halves also share `localPath`, which is the point of it living here: the
 * list and the check must agree on what counts as this build's own URL, or the
 * check passes on a set the worker never installs.
 */

/**
 * A URL the document names, as a path inside `dist` — or null if it is not ours.
 *
 * Only this build's own output. An absolute URL to somewhere else is not ours to
 * cache, and the app has none — which this quietly keeps true.
 */
export const localPath = (raw, base) =>
  raw.startsWith(base) ? raw.slice(base.length).split('?')[0].split('#')[0] : null

/** Tags, not bare attributes: telling an entry script from a favicon is the job. */
const TAGS = /<(script|link)\b([^>]*)>/gi

const attr = (raw, name) => new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(raw)?.[1] ?? ''

/**
 * The scripts and stylesheets of THIS build that the document loads.
 *
 * Inline scripts and cross-origin URLs fall out here rather than in the caller:
 * an inline `<script>` has no `src` and so no path, and a foreign URL is not
 * ours to precache — neither can stand in for the entry the page needs.
 */
export function entryAssets(html, base) {
  const found = { script: [], stylesheet: [] }
  for (const [, tag, raw] of html.matchAll(TAGS)) {
    const kind =
      tag.toLowerCase() === 'script'
        ? 'script'
        : /(^|\s)stylesheet(\s|$)/i.test(attr(raw, 'rel'))
          ? 'stylesheet'
          : null
    if (kind === null) continue
    const url = localPath(attr(raw, kind === 'script' ? 'src' : 'href'), base)
    if (url !== null) found[kind].push(url)
  }
  return found
}

/**
 * Every reason this precache would leave the app broken offline. Empty is good.
 *
 * Measured, against a copy of the real `dist` whose index.html still said
 * `assets/index-STALEHASH.js` while the build had emitted
 * `assets/index-Ca9MU_wN.js`: the reference scan in `make-sw.mjs` matched
 * nothing that existed on disk under those names, the script exited 0, and the
 * worker it wrote precached 9 files and 35KB — the shell, the manifest, the
 * icons, the favicon and the three modulepreloaded chunks — where the repaired
 * dist precaches 11 files and 2117KB. Note what that is NOT: it is not an empty
 * precache. Every file in it is real, the count looks healthy, and the 2MB entry
 * chunk and the stylesheet are the two things missing. That worker installs
 * cleanly and serves the cached shell offline, so the symptom is a blank page
 * with no console error and no build error. It is the failure the size ceiling
 * used to cause, arrived at from the other direction, and `make-sw.mjs` says
 * why that is worse than the dinosaur.
 *
 * @param {{ html: string, base: string, boot: ReadonlySet<string>, emittedCss: boolean }} input
 */
export function auditPrecache({ html, base, boot, emittedCss }) {
  const entries = entryAssets(html, base)
  const problems = []

  // Zero is its own failure and not the same one: it says the document changed
  // shape under the tag scan, not that a file went missing.
  if (entries.script.length === 0) problems.push('the document names no script of this build')

  // A build that inlines its CSS emits no `.css` at all, and that is fine. A
  // build that emitted stylesheets and links none of them is the scan missing.
  if (entries.stylesheet.length === 0 && emittedCss)
    problems.push('the build emitted CSS but the document links no stylesheet of this build')

  for (const url of [...entries.script, ...entries.stylesheet])
    if (!boot.has(url)) problems.push(`${url} is named by index.html but is not in dist/`)

  return problems
}
