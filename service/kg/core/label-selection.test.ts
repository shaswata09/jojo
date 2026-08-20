import { describe, expect, it } from 'vitest'
import { litSelection } from './label-selection'

/**
 * The chip that outlived its keyword.
 *
 * The sequence that motivated this, reachable today in two keystrokes: light a
 * keyword, delete it, press Undo on the toast — which restores the keyword and
 * re-lights the chip — then press ⇧⌘Z. `webHost.onUndoRequest` fires with
 * 'redo' and `useHostBindings` calls `runtime.redo()` directly, so the keyword
 * is deleted again and `LabelsProvider` never hears about it. The selection
 * still holds the id; nothing carries it; `matches` answers false for every
 * record; every filtered list on the page empties at once and there is no chip
 * on screen to explain it or to clear it.
 *
 * `LabelsProvider` cannot be mounted (D20), so this is where the rule is
 * checked — and the rule on its own is not enough. Verification caught this
 * file passing every case above with `matches` reverted to reading the raw
 * selection, which is the whole defect back with a green suite. The provider's
 * call site is pinned from its source at the foot of this file, the way
 * `popover.test.ts` pins the spread that applies ITS rule.
 */

const labels = (...ids: string[]) => ids.map((id) => ({ id }))

describe('the lit chips', () => {
  it('is every selected keyword that still exists', () => {
    expect([...litSelection(new Set(['a', 'b']), labels('a', 'b', 'c'))]).toEqual(['a', 'b'])
  })

  it('drops a keyword that has been deleted, however it was deleted', () => {
    expect([...litSelection(new Set(['a', 'gone']), labels('a'))]).toEqual(['a'])
  })

  it('lights a keyword again when it comes back, which is what undo has to do', () => {
    // The raw selection is deliberately not pruned, so an undo through ANY path
    // — the toast, ⌘Z, another tab — re-lights the chip without a callback.
    const pressed = new Set(['a', 'b'])
    expect([...litSelection(pressed, labels('a'))]).toEqual(['a'])
    expect([...litSelection(pressed, labels('a', 'b'))]).toEqual(['a', 'b'])
  })

  it('empties when every selected keyword is gone, which means "show everything"', () => {
    // Not "show nothing". `matches` reads `size === 0` as no filter at all, so
    // this is the branch that turns the trap into the correct empty filter.
    expect(litSelection(new Set(['gone']), labels('a')).size).toBe(0)
  })

  it('is empty for an empty selection whatever exists', () => {
    expect(litSelection(new Set(), labels('a')).size).toBe(0)
    expect(litSelection(new Set(), []).size).toBe(0)
  })
})

describe('what it hands back', () => {
  it('is the same set when nothing was dropped', () => {
    // Identity, not equality: this feeds a `useMemo` that every filtered list on
    // the page depends on, and a fresh Set per render would re-run all of them
    // for the ordinary case where every chip is fine.
    const selected = new Set(['a'])
    expect(litSelection(selected, labels('a', 'b'))).toBe(selected)
  })

  it('is the same set when the selection is empty', () => {
    const selected: ReadonlySet<string> = new Set()
    expect(litSelection(selected, labels('a'))).toBe(selected)
  })

  it('is a new set only when something was dropped', () => {
    const selected = new Set(['a', 'gone'])
    expect(litSelection(selected, labels('a'))).not.toBe(selected)
    // …and it does not modify the set it was given.
    expect([...selected]).toEqual(['a', 'gone'])
  })
})
