/**
 * The one property that matters: the list is copied BEFORE the input is
 * cleared. A `FileList` is live and the clear empties it, so a fake whose
 * clear empties the held list is the browser's behaviour, and the test that
 * fails when the two lines swap.
 */
import { describe, expect, it } from 'vitest'
import { pickedFiles } from './file-input'

function liveInput(names: readonly string[]) {
  const held = names.map((name) => new File(['x'], name))
  const list = held as unknown as FileList
  const input = {
    files: list as FileList | null,
    set value(next: string) {
      // Chrome: clearing the input empties the SAME FileList object a handler
      // already holds, rather than handing the input a fresh empty one.
      if (next === '') held.length = 0
    },
    get value() {
      return ''
    },
  }
  return input
}

describe('taking the picked files off an input', () => {
  it('returns the files, and the input is clear afterwards', () => {
    const input = liveInput(['CV.pdf', 'Statement.pdf'])
    const picked = pickedFiles(input)
    expect(picked.map((f) => f.name)).toEqual(['CV.pdf', 'Statement.pdf'])
    expect(input.files?.length).toBe(0)
  })

  it('is empty for an input with nothing picked', () => {
    expect(pickedFiles({ files: null, value: '' })).toEqual([])
  })
})
