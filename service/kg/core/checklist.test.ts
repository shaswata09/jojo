/**
 * The checklist's rules, over plain values.
 *
 * The first describe is the one that matters most and looks the least like a
 * feature test: `tx.patch` shallow-copies props, so the array staged as the
 * journal's before-image IS the array staged as the after-image. Any mutation
 * in this module edits both sides of an undo at once, and the failure is
 * silent — the undo runs, restores what is already there, and reports success.
 */

import { describe, expect, it } from 'vitest'
import {
  addBlocker,
  addItems,
  keyOf,
  openCount,
  postingSlice,
  removeItem,
  roomFor,
  setItem,
} from './checklist'
import { MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TEXT } from './model'
import type { ChecklistItem } from './model'

const NOW = '2026-09-14T09:00:00.000Z'
const item = (id: string, text: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  text,
  ...over,
})

const LIST: readonly ChecklistItem[] = [
  item('a', 'Order an official transcript'),
  item('b', 'Ask Dr. Rao for a letter', { doneOn: '2026-09-10' }),
  item('c', 'Write the diversity statement'),
]

describe('nothing here mutates what it is given', () => {
  /*
   * The undo contract, asserted rather than commented. If any of these fails,
   * every Undo on this card silently does nothing.
   */
  const frozen = () => LIST.map((i) => ({ ...i }))

  it('leaves the input array and its items untouched', () => {
    const before = frozen()
    addItems(before, ['Register for the portal'], ['d'])
    setItem(before, 'a', { done: true }, NOW)
    setItem(before, 'a', { text: 'changed' }, NOW)
    removeItem(before, 'a')
    expect(before).toEqual(frozen())
  })

  it('returns a NEW array whenever it changes anything', () => {
    const added = addItems(LIST, ['Register for the portal'], ['d'])
    expect(added).not.toBe(LIST)
    expect(setItem(LIST, 'a', { done: true }, NOW)).not.toBe(LIST)
    expect(removeItem(LIST, 'a')).not.toBe(LIST)
  })

  it('hands back the SAME array when nothing changed, so no write is staged', () => {
    // Each of these is a call the tools make on the way to deciding whether
    // there is anything to commit.
    expect(addItems(LIST, [], [])).toBe(LIST)
    expect(addItems(LIST, ['order an official transcript'], ['z'])).toBe(LIST)
    expect(setItem(LIST, 'nope', { done: true }, NOW)).toBe(LIST)
    expect(removeItem(LIST, 'nope')).toBe(LIST)
    expect(setItem(LIST, 'a', { text: 'Order an official transcript' }, NOW)).toBe(LIST)
  })

  it('keeps every untouched row referentially identical', () => {
    const next = setItem(LIST, 'a', { done: true }, NOW)
    expect(next[1]).toBe(LIST[1])
    expect(next[2]).toBe(LIST[2])
    expect(next[0]).not.toBe(LIST[0])
  })
})

describe('what counts as the same step', () => {
  it('ignores case, accents, spacing and trailing punctuation', () => {
    expect(keyOf('Email the chair.')).toBe(keyOf('email the chair'))
    expect(keyOf('Ask  Müller   for a letter')).toBe(keyOf('ask muller for a letter'))
    expect(keyOf('Submit the form!')).toBe(keyOf('Submit the form'))
  })

  it('keeps an interior full stop, which is part of the phrase', () => {
    expect(keyOf('Ask Dr. Rao for a letter')).not.toBe(keyOf('Ask Dr Rao for a letter'))
  })
})

describe('adding', () => {
  it('appends in order and leaves the existing items where they are', () => {
    const next = addItems(LIST, ['Register for the portal', 'Draft the cover letter'], ['d', 'e'])
    expect(next.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('drops a step already on the list, however it is worded', () => {
    const next = addItems(LIST, ['order an official transcript.', 'Register'], ['x', 'y'])
    expect(next.map((i) => i.text)).toEqual([...LIST.map((i) => i.text), 'Register'])
  })

  it('keeps one copy when the batch repeats itself', () => {
    const next = addItems([], ['Email the chair', 'email the chair.'], ['x', 'y'])
    expect(next).toHaveLength(1)
  })

  it('stamps provenance only when a model wrote it', () => {
    const drafted = addItems([], ['Order a transcript'], ['x'], { model: 'gemma', at: NOW })
    expect(drafted[0]?.by).toEqual({ model: 'gemma', at: NOW })
    expect(Object.hasOwn(addItems([], ['Typed'], ['y'])[0] ?? {}, 'by')).toBe(false)
  })

  it('stops at the cap rather than growing past it', () => {
    const full = Array.from({ length: MAX_CHECKLIST_ITEMS }, (_, i) =>
      item(`i${String(i)}`, `step ${String(i)}`),
    )
    expect(addItems(full, ['one more'], ['z'])).toBe(full)
    const nearly = full.slice(0, MAX_CHECKLIST_ITEMS - 1)
    expect(addItems(nearly, ['one', 'two'], ['y', 'z'])).toHaveLength(MAX_CHECKLIST_ITEMS)
  })

  it('refuses a line longer than one phrase, and blank ones', () => {
    expect(addItems([], ['x'.repeat(MAX_CHECKLIST_TEXT + 1)], ['a'])).toHaveLength(0)
    expect(addItems([], ['   '], ['a'])).toHaveLength(0)
  })
})

describe('ticking', () => {
  it('stamps the day it was ticked', () => {
    const next = setItem(LIST, 'a', { done: true }, NOW)
    expect(next[0]?.doneOn).toBe('2026-09-14')
  })

  it('does not restamp a step that is already done', () => {
    // The stamp is when the person decided, not when they last pressed.
    const next = setItem(LIST, 'b', { done: true }, '2026-12-01T09:00:00.000Z')
    expect(next).toBe(LIST)
    expect(next[1]?.doneOn).toBe('2026-09-10')
  })

  it('unticking REMOVES the key rather than storing undefined', () => {
    const next = setItem(LIST, 'b', { done: false }, NOW)
    expect(Object.hasOwn(next[1] ?? {}, 'doneOn')).toBe(false)
  })

  it('renames without touching the tick or the id', () => {
    const next = setItem(LIST, 'b', { text: 'Ask Dr. Rao for a reference' }, NOW)
    expect(next[1]).toMatchObject({ id: 'b', doneOn: '2026-09-10' })
    expect(next[1]?.text).toBe('Ask Dr. Rao for a reference')
  })

  it('refuses a rename to nothing, or past the length bound', () => {
    expect(setItem(LIST, 'a', { text: '   ' }, NOW)).toBe(LIST)
    expect(setItem(LIST, 'a', { text: 'x'.repeat(MAX_CHECKLIST_TEXT + 1) }, NOW)).toBe(LIST)
  })
})

describe('removing, counting and the add box', () => {
  it('keeps the order of what is left', () => {
    expect(removeItem(LIST, 'b').map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('counts what is still open', () => {
    expect(openCount(LIST)).toBe(2)
    expect(openCount(undefined)).toBe(0)
    expect(roomFor(LIST)).toBe(MAX_CHECKLIST_ITEMS - 3)
  })

  it('says why the add box cannot take this, in the words shown on the control', () => {
    expect(addBlocker(LIST, '')).toBeNull()
    expect(addBlocker(LIST, 'Something new')).toBeNull()
    expect(addBlocker(LIST, 'order an official transcript')).toMatch(/already on the list/)
    expect(addBlocker(LIST, 'x'.repeat(MAX_CHECKLIST_TEXT + 1))).toMatch(/characters/)
    const full = Array.from({ length: MAX_CHECKLIST_ITEMS }, (_, i) =>
      item(`i${String(i)}`, `step ${String(i)}`),
    )
    expect(addBlocker(full, 'one more')).toMatch(/most one application holds/)
  })
})

describe('the slice of a posting the model is shown', () => {
  it('leaves a short posting whole', () => {
    expect(postingSlice('short', 10, 10)).toBe('short')
  })

  it('keeps the head AND the tail, because How to apply is at the bottom', () => {
    const body = `${'H'.repeat(100)}${'M'.repeat(500)}${'T'.repeat(100)}`
    const cut = postingSlice(body, 100, 100)
    expect(cut.startsWith('H'.repeat(100))).toBe(true)
    expect(cut.endsWith('T'.repeat(100))).toBe(true)
    expect(cut).toContain('500 characters not shown')
    expect(cut).not.toContain('M'.repeat(101))
  })

  it('says what it left out exactly once', () => {
    const cut = postingSlice('x'.repeat(5000), 100, 100)
    expect(cut.match(/characters not shown/g)).toHaveLength(1)
  })
})
