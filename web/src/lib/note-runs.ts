/**
 * Reading the note editor's HTML into runs. The DOM half, and ONLY that.
 *
 * Web tests run under `environment: 'node'` and D20 forbids jsdom, so nothing
 * in this file can be tested — which is why nothing in it decides anything.
 * Every branch here is "read a property off an element". What a size means,
 * which colours exist, how offsets survive the whitespace cleanup and what is
 * dropped all live in `note-html.ts`, where a test can reach them.
 *
 * It is a second walker rather than a change to `rich-text.ts`. Three shipped
 * features depend on `textFromHtml`'s exact output, its DOM half is equally
 * untestable, and the failure mode of getting it wrong is a snippet coming back
 * with its paragraph breaks somewhere else. The two never have to agree on
 * anything — nothing outside the note reads spans, nothing inside it reads
 * `textFromHtml` — and the cleanup they share is pinned by a test.
 */

import type { RawRun } from '@/lib/note-html'

/** The same set `rich-text.ts` treats as ending a line, for the same reason. */
const BLOCKS = 'p, div, li, tr, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote'

const BOLD_TAGS = new Set(['B', 'STRONG'])
const ITALIC_TAGS = new Set(['I', 'EM'])
const UNDERLINE_TAGS = new Set(['U', 'INS'])
const STRIKE_TAGS = new Set(['S', 'STRIKE', 'DEL'])

/**
 * Everything on a text node, read off its ancestors.
 *
 * Both spellings of every mark, because `styleWithCSS` is advisory and pasted
 * markup obeys nothing: `<b>` and `font-weight: 700` mean the same thing here,
 * as do `<font size>` and `font-size`. The nearest ancestor that says anything
 * about a property wins, which is what CSS would do.
 */
function readStyle(node: Node): Omit<RawRun, 'text'> {
  const out: Omit<RawRun, 'text'> = {}
  let el: Element | null = node.parentElement
  while (el) {
    const tag = el.tagName
    if (BOLD_TAGS.has(tag)) out.bold = true
    if (ITALIC_TAGS.has(tag)) out.italic = true
    if (UNDERLINE_TAGS.has(tag)) out.underline = true
    if (STRIKE_TAGS.has(tag)) out.strike = true

    const style = el instanceof HTMLElement ? el.style : null
    if (style) {
      const weight = style.fontWeight
      if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) out.bold = true
      if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') out.italic = true
      const decoration = `${style.textDecorationLine} ${style.textDecoration}`
      if (decoration.includes('underline')) out.underline = true
      if (decoration.includes('line-through')) out.strike = true
      if (out.colour === undefined && style.color !== '') out.colour = style.color
      if (out.size === undefined && style.fontSize !== '') out.size = style.fontSize
    }
    // `<font color size>`, which `execCommand` still emits on some paths.
    if (tag === 'FONT') {
      const colour = el.getAttribute('color')
      const size = el.getAttribute('size')
      if (out.colour === undefined && colour !== null) out.colour = colour
      if (out.size === undefined && size !== null) out.size = size
    }
    el = el.parentElement
  }
  return out
}

/**
 * The editor's HTML → a flat list of runs, in order.
 *
 * Parsed into an inert document rather than assigned to an element, the same
 * precaution `textFromHtml` takes and for the same reason: a detached `<div>`
 * still fetches an `<img>` it is handed, and nothing here needs the network.
 *
 * Total by construction. An element this does not know contributes its TEXT and
 * no marks; an `<img>` contributes nothing at all, because only text nodes are
 * read. Handed a subtree of `<script>` and `<img onerror>`, the output is the
 * text those nodes contain — no tag, no attribute and no style string is ever
 * copied out of here.
 */
export function rawRunsFromHtml(html: string): RawRun[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  doc.querySelectorAll(BLOCKS).forEach((block) => {
    let prev = block.previousSibling
    while (prev && prev.nodeType === Node.TEXT_NODE && !prev.textContent?.trim()) {
      prev = prev.previousSibling
    }
    if (prev && !(prev instanceof Element && prev.matches(BLOCKS))) block.before('\n')
    block.append('\n')
  })

  const runs: RawRun[] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const text = node.textContent ?? ''
    if (text !== '') runs.push({ text, ...readStyle(node) })
    node = walker.nextNode()
  }
  return runs
}
