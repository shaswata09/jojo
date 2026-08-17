/**
 * Where a keystroke was headed, for the two shortcuts that must not steal it.
 *
 * Written twice, verbatim, with near-identical docstrings — once for the bare
 * `n` that opens the create menu and once for the ⌘K palette. It is
 * load-bearing for `n`, which is a single unmodified letter and would otherwise
 * open a menu in the middle of typing "engineer"; for ⌘K it is belt and braces,
 * and one of the two docstrings claimed the guard for a year before anyone
 * wrote it. Two copies of a rule that decides whether the user's typing reaches
 * the field they are typing into is one copy too many.
 */
export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  // `isContentEditable` is inherited, so a caret anywhere inside a rich-text
  // region counts, not just on the element carrying the attribute.
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
