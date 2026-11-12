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
  const html = String(kept.html ?? '')
  // First after the doctype and the comment, before anything the page wrote —
  // the same place `lockedCaptureHtml` puts it, for the reasons it gives.
  const lock = `<meta http-equiv="Content-Security-Policy" content="${CAPTURE_VIEW_CSP}">\n`
  return /^\s*<!doctype/i.test(html)
    ? html.replace(/^(\s*<!doctype[^>]*>)/i, `$1\n${provenance}${lock}`)
    : `<!doctype html>\n${provenance}${lock}${html}`
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
