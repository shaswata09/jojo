/**
 * A kept page as one self-contained HTML file — the pure half of `save.js`.
 *
 * Split out so a test can reach it. `save.js` talks to `chrome.*` and starts a
 * download the moment it loads, so importing it anywhere but a browser would
 * run that; this file has no side effects and no dependencies. It is checked by
 * `web/src/lib/capture-save.test.ts`.
 */

/**
 * The page as a file: a provenance comment, and a doctype if it lacks one.
 *
 * The comment is so a file found a year later can still say where it came from
 * and when. The doctype is defensive — the serialiser keeps it today — but a
 * file without one opens in quirks mode, which changes box sizing and table
 * layout on the standards-mode pages essentially every job board serves.
 *
 * `--` in the address is escaped: an HTML comment cannot contain it, and an
 * address carrying `-->` would otherwise end the comment early and spill the
 * rest of the sentence into the page as text.
 */
/**
 * The policy the saved file opens under: nothing but `data:`. A transcription of
 * `CAPTURE_VIEW_CSP` in `service/kg/core/capture.ts`, checked against it by
 * `capture-save.test.ts`.
 *
 * jojo's own viewer writes this in before rendering a capture; a DOWNLOADED copy
 * is opened straight from disk, with no sandbox and no viewer, so it carries
 * the policy itself. A remote reference every check missed is then refused by
 * the browser that opens the file, rather than fetched from somebody's desk.
 */
export const CAPTURE_VIEW_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'"

export function asFile(kept) {
  const source = String(kept.url ?? '').replace(/--/g, '%2D%2D')
  const when = String(kept.capturedAt ?? '').replace(/--/g, '')
  const provenance =
    `<!-- Saved by the jojo extension from ${source} on ${when}. ` +
    'Styles, images and fonts are embedded; scripts were removed, so it opens offline. -->\n'
  /*
   * The head this file opens with is written HERE, ahead of every byte the page
   * wrote, rather than slotted in after the page's own doctype by a pattern.
   * That pattern (`^\s*<!doctype`) read the start of the page the way a regex
   * does, not the way the HTML parser does, and `lockedCaptureHtml` measured
   * where the two disagree: a leading NBSP or BOM, or a comment the parser ends
   * early, and the policy landed somewhere it does not apply. A doctype of the
   * page's own that comes later is a stray the parser ignores, so the page's
   * leading one is simply dropped.
   *
   * `charset` first, because the page's own <meta> tags do not survive (below)
   * and a file opened from disk carries no content type.
   */
  const head =
    '<meta charset="utf-8">\n' +
    `<meta http-equiv="Content-Security-Policy" content="${CAPTURE_VIEW_CSP}">\n` +
    '<meta http-equiv="x-dns-prefetch-control" content="off">\n'
  const html = String(kept.html ?? '').replace(/^\uFEFF*[\t\n\f\r ]*(?:<!doctype[^>]*>)?/i, '')
  return `<!doctype html>\n${provenance}${head}${inertHeadTags(html)}`
}

/**
 * Every `<link>` and `<meta>` the page wrote, made into an element that does
 * nothing.
 *
 * The CSP above stops fetches. It does not stop NAVIGATION — a
 * `<meta http-equiv=refresh>` sends the file, opened from disk with no sandbox
 * around it, to any address on open — nor a `<link rel=preconnect>` or
 * `dns-prefetch`, which open a connection the policy never sees. Reproduced:
 * a downloaded capture carrying a refresh beaconed the moment it was opened.
 * The serialiser removes those, and this is the file's own answer for the one
 * that got past it.
 *
 * Renamed rather than parsed and filtered. Deciding which ones are harmless
 * means reading their attributes, and a pattern reads an unquoted value with a
 * stray `"` in it differently from the parser — the shape every regex-over-HTML
 * check in this extension has lost to. Renaming the TAG needs no attributes at
 * all: `<basefont>` is void and parsed exactly like `<link>` in a head, so the
 * document's structure is unchanged, and it does nothing in any current
 * browser. The page's own charset and viewport go with the rest; the head
 * above supplies the charset.
 *
 * `sandbox` is not added to the policy: a CSP delivered by <meta> may not carry
 * it, and browsers ignore it there.
 */
export function inertHeadTags(html) {
  return html.replace(/<(?:link|meta)(?=[\t\n\f\r />])/gi, '<basefont')
}

/** 'senior-ml-engineer-2026-09-11.html' — readable, and safe on every filesystem. */
export function fileNameFor(kept) {
  let host = ''
  try {
    host = new URL(kept.url).hostname
  } catch {
    host = ''
  }
  const base =
    String(kept.title || host || 'kept-page')
      // 'Ingénieur' -> 'Ingenieur': decompose, then drop the combining marks.
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '')
      .toLowerCase() || 'kept-page'
  const day = String(kept.capturedAt ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${base}-${day}.html` : `${base}.html`
}
