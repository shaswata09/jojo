/**
 * What Settings counts as "something in the store".
 *
 * Written against a data-loss bug: the count was a hand-written list of eight
 * types, so a store holding only a sticky note, a conversation, a contact or CV
 * facts read as empty. Settings then disabled "Clear records" and the Load demo
 * dialog promised nothing would be replaced, offered no export, and deleted all
 * of it. Pure function, no renderer (D20).
 */
import { describe, expect, it } from 'vitest'
import { NODE_TYPES } from '../core/model'
import type { NodeType } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'
import { storeContents } from './use-admin'

/** A graph holding one node of each named type and nothing else. */
const holding = (...types: NodeType[]): Pick<GraphSnapshot, 'ofType'> =>
  ({
    ofType: (type: NodeType) => (types.includes(type) ? [{ id: `${type}:1`, type }] : []),
  }) as unknown as Pick<GraphSnapshot, 'ofType'>

describe('storeContents', () => {
  it('reads a store with nothing in it and a blank profile as empty', () => {
    expect(storeContents(holding(), true)).toEqual({ isEmpty: true, demoReplacesNothing: true })
  })

  it('counts a profile with something in it', () => {
    expect(storeContents(holding(), false)).toEqual({ isEmpty: false, demoReplacesNothing: false })
  })

  // Every type the wipe removes, one at a time, so a type added to the model is
  // covered without anyone remembering to add it here.
  const counted = NODE_TYPES.filter((t) => !['keyword', 'profile', 'organisation'].includes(t))

  it.each(counted)('counts a store holding only a %s', (type) => {
    expect(storeContents(holding(type), true)).toEqual({
      isEmpty: false,
      demoReplacesNothing: false,
    })
  })

  it('covers the types the old list forgot', () => {
    for (const type of ['stickyNote', 'thread', 'person', 'background', 'claim'] as const) {
      expect(counted).toContain(type)
    }
  })

  it('keeps keywords out of "Clear records" but not out of the demo', () => {
    // "Clear records" keeps keywords, so they are nothing for it to clear. Loading
    // the demo replaces them with its own, so they are something it would take.
    expect(storeContents(holding('keyword'), true)).toEqual({
      isEmpty: true,
      demoReplacesNothing: false,
    })
  })

  it('does not count an organisation, which is minted rather than made', () => {
    expect(storeContents(holding('organisation'), true)).toEqual({
      isEmpty: true,
      demoReplacesNothing: true,
    })
  })
})
