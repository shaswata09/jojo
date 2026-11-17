/**
 * Where a search result lands when its exact row is not on screen.
 *
 * Focus ids are dotted paths — `settings.model.apiKey` sits inside
 * `settings.model` — so a row that is not drawn right now (the API key field
 * appears only for a provider that needs a key; Saved as only once a server
 * answered) still lands on the panel that would hold it, rather than on the
 * top of the page with nothing lit.
 *
 * Returns the id itself when it is known, else its nearest known ancestor,
 * else null.
 */
export function nearestFocus(id: string, known: (candidate: string) => boolean): string | null {
  let at = id
  for (;;) {
    if (known(at)) return at
    const cut = at.lastIndexOf('.')
    if (cut < 0) return null
    at = at.slice(0, cut)
  }
}
