/**
 * `sortDrop`, and the branch that decides whether a drop is refused.
 *
 * Written because that branch grew a second meaning and nothing was watching:
 * once a record could exist WITHOUT its document — which is exactly what a write
 * refused on quota leaves — "a file of this name is already here" stopped being
 * the same question as "this file is already stored". Treating the two as one
 * made the quota toast's own instruction, *drop the file in again*, impossible
 * to follow.
 */

import { describe, expect, it } from 'vitest'
import type { VaultFile } from '@jojo/service/core/model'
import { sortDrop } from '@/components/vault/files/intake'

const record = (name: string, id = name): VaultFile =>
  ({ id: `file:${id}`, name, kind: 'pdf', bucket: 'To read', size: '1 KB', savedOn: '2026-01-01' }) as VaultFile

/** `FileList` is a DOM type; the code only ever iterates it. */
const drop = (...names: string[]) =>
  names.map((n) => new File([new Uint8Array([1])], n)) as unknown as FileList

describe('sortDrop', () => {
  it('files a name the vault has never seen', () => {
    const out = sortDrop(drop('CV.pdf'), [])
    expect(out.fresh).toHaveLength(1)
    expect(out.refill).toHaveLength(0)
    expect(out.skipped).toBe(0)
  })

  it('refuses a name whose record already holds a document', () => {
    const out = sortDrop(drop('CV.pdf'), [record('CV.pdf')], () => true)
    expect(out.fresh).toHaveLength(0)
    expect(out.refill).toHaveLength(0)
    expect(out.skipped).toBe(1)
  })

  it('REFILLS a record that has no document rather than calling it a duplicate', () => {
    // The quota case. Before this the drop was filtered out, no write was
    // attempted, and the user was told the file was "already here" — about a
    // row whose document had never been stored.
    const empty = record('CV.pdf')
    const out = sortDrop(drop('CV.pdf'), [empty], () => false)
    expect(out.fresh).toHaveLength(0)
    expect(out.skipped).toBe(0)
    expect(out.refill).toHaveLength(1)
    expect(out.refill[0]!.record.id).toBe(empty.id)
  })

  it('gives one empty record to one file when a name is dropped twice at once', () => {
    // Two drops of a name against one empty shelf: the second must not claim the
    // same record, or both writes race onto one id and one silently wins.
    const out = sortDrop(drop('CV.pdf', 'CV.pdf'), [record('CV.pdf')], () => false)
    expect(out.refill).toHaveLength(1)
    expect(out.fresh).toHaveLength(0)
    expect(out.skipped).toBe(1)
  })

  it('folds case and surrounding space, as it always did', () => {
    const out = sortDrop(drop('  cv.PDF  '), [record('CV.pdf')], () => true)
    expect(out.skipped).toBe(1)
  })

  it('behaves exactly as before when no byte predicate is given', () => {
    // The default has to stay "assume every record holds its document", or every
    // existing caller changes meaning silently.
    const out = sortDrop(drop('CV.pdf'), [record('CV.pdf')])
    expect(out.refill).toHaveLength(0)
    expect(out.skipped).toBe(1)
  })

  it('keeps the totals adding up', () => {
    const out = sortDrop(
      drop('new.pdf', 'stored.pdf', 'empty.pdf'),
      [record('stored.pdf', 's'), record('empty.pdf', 'e')],
      (f) => f.id === 'file:s',
    )
    expect(out.fresh).toHaveLength(1)
    expect(out.refill).toHaveLength(1)
    expect(out.skipped).toBe(1)
    expect(out.fresh.length + out.refill.length + out.skipped).toBe(out.picked.length)
  })
})
