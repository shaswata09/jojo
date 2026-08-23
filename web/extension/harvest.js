/**
 * Runs inside a job board's own page and hands back every link it can see.
 *
 * DELIBERATELY STUPID. It makes no judgement about what a job is — that rule
 * lives in `service/kg/core/board.ts` and `readListings` applies it on the far
 * side. The split is not tidiness: a predicate here would be a second copy of a
 * rule that already has an owner, and the capture policy has already taught this
 * codebase what an unchecked transcription costs. `web/extension/policy.js`
 * needs a test that refuses to let it drift; a regex would need a harder one. So
 * this over-collects, and the package throws away what is not a posting.
 *
 * It is also the only half of this that CAN run: an MV3 service worker has no
 * `DOMParser`, and a board that renders its results with JavaScript has nothing
 * in its served HTML to parse anyway. A real tab has both a DOM and the page's
 * own scripts, which is why the worker opens one.
 *
 * WHAT IT DOES NOT DO. It does not scroll, click "more", or wait for a second
 * page of results. One screenful of a board is what a person sees when they open
 * it, and a scraper that pages through everything is a different, ruder thing
 * than the one this feature promised.
 *
 * Passed to `chrome.scripting.executeScript` as a function, so it is serialised
 * to source and re-parsed in the page: it may not close over anything, and
 * everything it returns must survive a structured clone.
 */

export function harvest(limit) {
  /** Attribute values that name an employer or a place, across the big boards. */
  const ORG_HINT = /(company|employer|organisation|organization|subtitle)/i
  const PLACE_HINT = /(location|locality|region|place|workplace|office)/i

  const clean = (text) => (text || '').replace(/\s+/g, ' ').trim()

  /**
   * The nearest thing that looks like a card around this link.
   *
   * Four hops, not "the whole document": the employer and location for a row
   * live inside that row, and a wider walk starts reading the row above.
   */
  const cardOf = (anchor) => {
    let node = anchor
    for (let hop = 0; hop < 4 && node.parentElement; hop += 1) {
      node = node.parentElement
      const tag = node.tagName.toLowerCase()
      if (tag === 'li' || tag === 'article' || node.getAttribute('role') === 'listitem') return node
    }
    return anchor.parentElement || anchor
  }

  /** A field inside the card whose class or test id says what it is. */
  const fieldIn = (card, pattern, exclude) => {
    const nodes = card.querySelectorAll('[class],[data-testid],[data-test],[itemprop]')
    for (const node of nodes) {
      if (node === exclude || node.contains(exclude)) continue
      const marks = [
        node.getAttribute('class') || '',
        node.getAttribute('data-testid') || '',
        node.getAttribute('data-test') || '',
        node.getAttribute('itemprop') || '',
      ].join(' ')
      if (!pattern.test(marks)) continue
      const text = clean(node.textContent)
      // A container whose class matched but which holds the whole card is not
      // the field; a real one is short.
      if (text.length > 0 && text.length <= 80) return text
    }
    return ''
  }

  const rows = []
  const seen = new Set()

  for (const anchor of document.querySelectorAll('a[href]')) {
    if (rows.length >= limit) break

    // `href` on an anchor is already absolute and already resolved against the
    // page's base; the raw attribute is not.
    const url = anchor.href
    if (!url || seen.has(url)) continue
    if (!/^https?:/i.test(url)) continue
    seen.add(url)

    /*
     * The link's own text is usually the job title, but on several boards the
     * whole card is one anchor and its text is title + employer + location +
     * "Easy Apply" run together. A heading inside it is the better answer
     * wherever there is one.
     */
    const heading = anchor.querySelector('h1,h2,h3,h4,strong')
    const title = clean(heading ? heading.textContent : anchor.textContent) ||
      clean(anchor.getAttribute('aria-label')) ||
      clean(anchor.getAttribute('title'))
    if (!title) continue

    const card = cardOf(anchor)
    rows.push({
      url,
      title: title.slice(0, 300),
      org: fieldIn(card, ORG_HINT, heading || anchor).slice(0, 120),
      location: fieldIn(card, PLACE_HINT, heading || anchor).slice(0, 120),
    })
  }

  return rows
}
