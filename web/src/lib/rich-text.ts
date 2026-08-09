/**
 * Converting between the rich-text editor's HTML and the plain text that is
 * actually stored.
 *
 * Shared rather than duplicated: the snippet editor and the file-notes drawer
 * both round-trip through these, and two copies of a parser this fiddly drift
 * the first time either is fixed.
 */

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Everything the editor can emit that ends a line. `execCommand` produces
 *  `<div>` as readily as `<p>`, and lists and tables come from the toolbar. */
const BLOCKS = 'p, div, li, tr, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote'

/**
 * Stored body → editor HTML.
 *
 * Escaped on the way in. The body is plain text, so a '<' in it is a less-than
 * sign the user typed; handed to the editor raw it becomes markup, and the save
 * path below would then spell it back out as something else entirely.
 */
export function htmlFromText(text: string) {
  return text
    .split('\n')
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
    .join('')
}

/**
 * Editor HTML → the plain text that is actually stored.
 *
 * Parsed into an inert document rather than assigned to an element: a detached
 * `<div>` still fetches an `<img>` it is handed, and nothing here needs the
 * network. Block ends are turned into newlines *before* `textContent` flattens
 * the tree, because `textContent` on its own runs every paragraph of an email
 * template into a single line — which is exactly the thing these snippets exist
 * to preserve.
 */
export function textFromHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))

  doc.querySelectorAll(BLOCKS).forEach((block) => {
    /**
     * A block that follows loose inline content needs the break in FRONT of it
     * as well. That is the shape a browser leaves when you type into an empty
     * editor and press return — 'Hello<div>world</div>', with the first line
     * wrapped in nothing — and without this the two lines are stored as one
     * word. Whitespace-only text between blocks does not count, or every
     * paragraph would gain a blank line after it.
     */
    let prev = block.previousSibling
    while (prev && prev.nodeType === Node.TEXT_NODE && !prev.textContent?.trim()) {
      prev = prev.previousSibling
    }
    if (prev && !(prev instanceof Element && prev.matches(BLOCKS))) block.before('\n')
    block.append('\n')
  })

  return (
    (doc.body.textContent ?? '')
      .replace(/[^\S\n]+\n/g, '\n')
      // Nested blocks each contribute an ending, so a paragraph inside a div ends
      // up with two. One blank line is the most any gap can mean here.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
