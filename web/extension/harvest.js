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
 * WHAT IT DOES NOT DO. It does not scroll, click, or follow a second page of
 * results — the worker presses a board's "Load more" before this runs
 * (`expandListing`), and the package follows next-page links one tab at a time
 * (`crawlBoard` in `core/board.ts`). This only reports what the page links to,
 * including each link's `rel`, so the package can tell "next page" from a job.
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
    // Marked seen only once it is KEPT. AcademicCareers opens every card with
    // its logo — a link to the job with an image and no text — and marking
    // that one seen threw away the titled link under it: every posting on the
    // board, measured 2026-10-22.
    if (!title) continue
    seen.add(url)

    const card = cardOf(anchor)
    rows.push({
      url,
      title: title.slice(0, 300),
      org: fieldIn(card, ORG_HINT, heading || anchor).slice(0, 120),
      location: fieldIn(card, PLACE_HINT, heading || anchor).slice(0, 120),
      // "next" and "prev" are how a pager says which link is which, where it
      // says so at all. Read by `pageLinks` in the package.
      rel: clean(anchor.getAttribute('rel')).slice(0, 40),
    })
  }

  // The page's own statement of its next page, in the head where no anchor is.
  const declared = document.querySelector('link[rel~="next"][href]')
  if (declared && declared.href && /^https?:/i.test(declared.href) && !seen.has(declared.href)) {
    rows.push({ url: declared.href, title: 'Next', org: '', location: '', rel: 'next' })
  }

  return rows
}

/**
 * Presses a board's "Load more" until it stops adding links, or for a few
 * rounds at most.
 *
 * Some boards have no second page to follow: AcademicCareers' `/jobs/` list
 * grows in place behind a "Load more" button and links nowhere. Pressing it is
 * the only way to see past the first screenful, and pressing it is what the
 * person would do — the same tab, the same session, nothing opened.
 *
 * Bounded twice over, because this runs unattended: at most `rounds` presses,
 * and it stops the first time a press adds no links. Only a control whose
 * whole text is "load/show/view/see more" (with "jobs", "results" or
 * "listings" allowed after it) is pressed — never a link that leads anywhere.
 */
export async function expandListing(rounds, waitMs, budgetMs) {
  const MORE = /^(?:load|show|view|see)\s+more(?:\s+(?:jobs|results|listings|positions|postings))?\.{0,3}$/i
  const clean = (text) => (text || '').replace(/\s+/g, ' ').trim()
  const visible = (el) => {
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const findMore = () => {
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      if (!MORE.test(clean(el.textContent))) continue
      if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !visible(el)) continue
      // A real link elsewhere is navigation, not "more of this list".
      const href = el.getAttribute && el.getAttribute('href')
      if (el.tagName === 'A' && href && !/^(#|javascript:)/i.test(href.trim())) continue
      return el
    }
    return null
  }

  /*
   * Polled rather than slept: AcademicCareers answers a press in 1.0–1.5s
   * (measured), so a fixed 1.5s wait checked a hair before the new rows landed
   * and stopped after one press. Each press waits until the list grows, up to
   * `waitMs`; the whole thing stops at `budgetMs`, so the scan stays inside
   * the page's budget however slow the board is.
   */
  const links = () => document.querySelectorAll('a[href]').length
  const started = Date.now()
  let pressed = 0
  for (let round = 0; round < rounds && Date.now() - started < budgetMs; round += 1) {
    const more = findMore()
    if (!more) break
    const before = links()
    more.scrollIntoView({ block: 'center' })
    more.click()
    pressed += 1
    let grew = false
    for (let waited = 0; waited < waitMs && Date.now() - started < budgetMs; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (links() > before) {
        grew = true
        break
      }
    }
    if (!grew) break
  }
  return pressed
}
