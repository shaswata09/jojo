/**
 * Whether a scroller is close enough to its end to be pinned there.
 *
 * Its own module because the Assistant's transcript is the only thing in this
 * app that grows while somebody is reading it, and because a component cannot
 * be tested here (D20) — a rule about a scroll position that nothing can run is
 * a rule nobody has checked.
 *
 * THE DEFECT IT EXISTS FOR. The transcript's effect set `scrollTop =
 * scrollHeight` on every change of `entries`, and `agent-runs.ts` rewrites the
 * streaming answer once per delta — so the box was slammed back to the bottom
 * once per token, for the length of every answer. Scrolling up to re-read the
 * tool row that produced what is being said now was not slow or awkward, it was
 * impossible: the next fragment arrived within a frame or two and took the view
 * back. The page's own promise is "everything it does is listed as it happens",
 * and a list you cannot look back through is not that.
 */

/**
 * Near enough counts, and the slack is why.
 *
 * A scroller pinned to its end is routinely a pixel or two short of it —
 * fractional device pixels, a sub-pixel line height, a browser that rounds
 * `scrollTop` differently from `scrollHeight`. Requiring exact equality would
 * unpin the view on the first token and leave it stranded mid-answer. 48px is
 * about one line of a reply plus its leading: far enough to survive rounding,
 * near enough that a reader who has scrolled up to read anything at all is
 * outside it.
 */
export const STICK_SLACK_PX = 48

export function atBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  slack: number = STICK_SLACK_PX,
): boolean {
  // A box with nothing to scroll is at its end by definition — otherwise an
  // empty transcript would start unpinned and never follow its first answer.
  return scrollHeight - clientHeight - scrollTop <= slack
}
