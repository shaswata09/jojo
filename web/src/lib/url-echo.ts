/**
 * Tells a text box's own writes to the URL apart from somebody else's.
 *
 * WHY. A search box bound straight to a URL parameter loses keystrokes: the
 * router applies each location change inside a React transition, React puts a
 * controlled input back to the last COMMITTED value until that transition
 * lands, and on a page slow enough to re-render (hundreds of applications, a
 * slow phone) the next key arrives first and the characters in between are
 * gone. So the box keeps its own text and writes the URL behind it.
 *
 * That leaves one question each time the parameter changes: is this the echo
 * of something the box wrote — possibly an older write, landing after the box
 * has moved on — or a change from outside (Back, "Clear filters", a link)
 * that the box should adopt? An echo of an old write must NOT be adopted, or
 * the box jumps back mid-word, which is the bug this replaces.
 */
export interface UrlEcho {
  /** Record a value the box is about to write to the URL. */
  sent(value: string): void
  /**
   * The URL now holds `value`. True when that is one of the box's own writes
   * still in flight (it, and every older one, is then settled); false when it
   * came from elsewhere, which also forgets anything still pending.
   */
  isEcho(value: string): boolean
}

export function urlEcho(): UrlEcho {
  let pending: string[] = []
  return {
    sent(value) {
      pending.push(value)
    },
    isEcho(value) {
      const at = pending.lastIndexOf(value)
      if (at >= 0) {
        pending = pending.slice(at + 1)
        return true
      }
      pending = []
      return false
    },
  }
}
