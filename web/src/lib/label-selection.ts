/**
 * Which of the lit keyword chips still exist.
 *
 * The filter's selection is a set of keyword ids held in React state, and the
 * keywords themselves are nodes in the graph. Those two can come apart, and
 * when they do the failure is the one `labels.tsx` names in its own comment: a
 * selection holding one id that nothing carries reads as "show me the records
 * carrying it", which is none of them, so every filtered list on the page
 * empties at once with no chip left on screen to explain it or to clear.
 *
 * `LabelsProvider` used to keep the two in step by hand, inside `removeLabel`
 * and inside the `restore` it hands to the delete toast. That covers exactly one
 * of the ways a keyword can vanish. It does not cover:
 *
 *   - ⇧⌘Z. `webHost.onUndoRequest` fires with 'redo' and `useHostBindings` in
 *     `kg/react/kg.tsx` calls `runtime.redo()` directly, so a keyword deleted,
 *     undone from the toast, then redone from the keyboard is gone from the
 *     graph and still lit. Two keystrokes, and every list on the page empties.
 *   - ⌘Z, which restores the keyword without re-lighting the chip it was on.
 *   - another tab, or a `keyword.delete` run from the Tools dialog.
 *
 * So the selection is no longer maintained; it is DERIVED. The raw set is what
 * the user pressed and is kept as-is — including ids whose keyword is currently
 * deleted — and what the filter reads is this intersection with the keywords
 * that exist right now. A delete un-lights the chip through every path at once,
 * and an undo re-lights it through every path at once, because both are the
 * same fact about the graph rather than two callbacks that have to agree.
 *
 * Its own module because `LabelsProvider` cannot be mounted (D20 — no jsdom, no
 * component tests), and a rule that lives only inside a provider is a rule
 * nothing checks. `lib/labels.tsx`'s twin on the phone has neither the fix nor a
 * test; the divergence is deliberate and is the fix arriving on one platform
 * first.
 */

/**
 * Identity is preserved when nothing was dropped, deliberately.
 *
 * `selected` is a `useMemo` dependency of the context value and of `matches`,
 * and both of those are read by every filtered list on the page. Returning a
 * fresh `Set` on every render would re-run all of them on every render, which is
 * the cost this derivation would otherwise add for the ordinary case where
 * every lit chip is a keyword that exists.
 */
export function litSelection(
  selected: ReadonlySet<string>,
  labels: readonly { id: string }[],
): ReadonlySet<string> {
  if (selected.size === 0) return selected

  const exists = new Set(labels.map((label) => label.id))
  let missing = false
  for (const id of selected) {
    if (!exists.has(id)) {
      missing = true
      break
    }
  }
  if (!missing) return selected

  const lit = new Set<string>()
  for (const id of selected) if (exists.has(id)) lit.add(id)
  return lit
}
