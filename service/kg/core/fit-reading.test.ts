/**
 * The three states a stored reading can be in, and the two doubts about one.
 *
 * Every assertion here is a sentence a panel would otherwise say wrongly, and
 * under D20 no panel can be mounted to catch it — there are two of them, and
 * the last person to change their shared logic had to do it twice by hand.
 *
 * The case that matters most is `isCleared` against an empty list. A posting
 * that states nothing measurable and a reading somebody threw away both end up
 * holding zero requirements, and only one of them must stop the panel reading
 * the page again. Collapsing them is how the Clear button comes to look broken.
 */

import { describe, expect, it } from 'vitest'
import { answered, isCleared, readingOn, staleOf, STALE_NOTE } from './fit-reading'
import type { PostingReading, StoredNode } from './model'

const READING: PostingReading = {
  requirements: [
    { text: 'PhD in computer science', essential: true },
    { text: 'distributed systems', essential: false },
  ],
  model: 'gemma_4_31b',
  readAt: '2026-09-12T10:00:00.000Z',
}

/** A file node with whatever props this case is about. */
const fileWith = (props: Partial<StoredNode<'file'>['props']>): StoredNode<'file'> => ({
  id: 'file:0192-a' as StoredNode<'file'>['id'],
  type: 'file',
  props: {
    slug: 'posting',
    name: 'Assistant Professor — CS.html',
    kind: 'page',
    bucket: 'Job postings',
    size: '184 KB',
    savedOn: '2026-09-12',
    ...props,
  },
  createdAt: '2026-09-12T09:00:00.000Z',
  updatedAt: '2026-09-12T09:00:00.000Z',
})

describe('reading a file that has one', () => {
  it('finds the reading', () => {
    expect(readingOn(fileWith({ reading: READING }))).toEqual(READING)
  })

  it('answers undefined for a file with none, and for no file at all', () => {
    // Both reach the panel: a record with no reading yet, and an id that
    // resolves to nothing because the document was deleted under it.
    expect(readingOn(fileWith({}))).toBeUndefined()
    expect(readingOn(undefined)).toBeUndefined()
  })
})

describe('telling a discard from a posting with nothing in it', () => {
  it('calls a stamped reading cleared', () => {
    expect(isCleared({ ...READING, requirements: [], clearedAt: '2026-09-12T11:00:00.000Z' })).toBe(
      true,
    )
  })

  it('does NOT call an empty reading cleared', () => {
    /*
     * THE assertion. `assess` has a real case for a posting that states nothing
     * measurable and the panel says so honestly; if that read as a discard, the
     * panel would stop measuring a document nobody refused. And the reverse is
     * the broken-button bug: a discard that read as "not yet read" is a model
     * call on the next render.
     */
    expect(isCleared({ ...READING, requirements: [] })).toBe(false)
  })

  it('does not call a missing reading cleared', () => {
    expect(isCleared(undefined)).toBe(false)
  })
})

describe('whether there is an answer to show', () => {
  it('shows a reading', () => {
    expect(answered(READING)).toBe(true)
  })

  it('shows a reading that found nothing, because that is an answer', () => {
    expect(answered({ ...READING, requirements: [] })).toBe(true)
  })

  it('shows nothing for a cleared one, or for none', () => {
    expect(answered({ ...READING, clearedAt: '2026-09-12T11:00:00.000Z' })).toBe(false)
    expect(answered(undefined)).toBe(false)
  })
})

describe('what is worth doubting', () => {
  /*
   * Only the model. "The document changed" is deliberately not checked — see
   * the header: nothing in the app writes `FileProps.hash`, and a comparison
   * against a field nobody writes is a warning that never fires.
   */
  it('says nothing about a reading taken by the connected model', () => {
    expect(staleOf(READING, 'gemma_4_31b')).toBeNull()
  })

  it('notices the model changed', () => {
    expect(staleOf(READING, 'qwen3_14b')).toBe('model')
  })

  it('says nothing when no model is connected', () => {
    /*
     * Two pieces of bad news for one missing setting. The panel is already
     * telling this person to connect a model; adding "and your reading is out
     * of date" is noise about something they cannot act on yet.
     */
    expect(staleOf(READING, '')).toBeNull()
    expect(staleOf(READING, '   ')).toBeNull()
  })

  it('doubts nothing about a cleared or missing reading', () => {
    const cleared = { ...READING, clearedAt: '2026-09-12T11:00:00.000Z' }
    expect(staleOf(cleared, 'qwen3_14b')).toBeNull()
    expect(staleOf(undefined, 'qwen3_14b')).toBeNull()
  })

  it('has a sentence for each doubt', () => {
    // A `Record<Stale, string>` on the map and this assertion on its contents:
    // between them a third doubt cannot be added without copy for it.
    expect(Object.keys(STALE_NOTE).sort()).toEqual(['model'])
    for (const note of Object.values(STALE_NOTE)) expect(note.length).toBeGreaterThan(20)
  })
})
