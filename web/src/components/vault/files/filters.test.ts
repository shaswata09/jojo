import { describe, expect, it } from 'vitest'
import { activeFilterCount, isUnfiled, unfiledCount, visibleFiles } from './filters'
import type { FileFilters } from './filters'
import type { VaultFile } from '@/data/vault'

const file = (id: string, patch: Partial<VaultFile> = {}): VaultFile => ({
  id,
  name: `${id}.pdf`,
  kind: 'pdf',
  bucket: 'To read',
  size: '1 KB',
  savedOn: '2026-09-14',
  applicationIds: [],
  ...patch,
})

/** Everything through, which is what every control looks like when it is off. */
const OFF: FileFilters = {
  bucket: 'all',
  unfiledOnly: false,
  keywords: () => true,
  search: () => true,
}

const ids = (files: readonly VaultFile[]) => files.map((f) => f.id)

describe('whether a file is filed under anything', () => {
  it('is unfiled with an empty list', () => {
    expect(isUnfiled(file('a'))).toBe(true)
  })

  it('is filed with one application, or several', () => {
    expect(isUnfiled(file('a', { applicationIds: ['app-1'] }))).toBe(false)
    expect(isUnfiled(file('a', { applicationIds: ['app-1', 'app-2'] }))).toBe(false)
  })

  it('counts the unfiled ones for the chip', () => {
    const files = [file('a'), file('b', { applicationIds: ['x'] }), file('c')]
    expect(unfiledCount(files)).toBe(2)
    expect(unfiledCount([])).toBe(0)
  })
})

describe('the unfiled filter on its own', () => {
  const files = [file('loose'), file('filed', { applicationIds: ['app-1'] }), file('also-loose')]

  it('shows everything when it is off', () => {
    expect(ids(visibleFiles(files, OFF))).toEqual(['loose', 'filed', 'also-loose'])
  })

  it('shows only what is filed under nothing when it is on', () => {
    expect(ids(visibleFiles(files, { ...OFF, unfiledOnly: true }))).toEqual(['loose', 'also-loose'])
  })

  it('keeps the order the list was already in', () => {
    // The list is sorted upstream; a filter must not become a sort.
    expect(ids(visibleFiles(files, { ...OFF, unfiledOnly: true }))).toEqual(['loose', 'also-loose'])
  })
})

describe('the four filters together', () => {
  /*
   * The case this file exists for. Each filter is obviously right alone, and
   * the failure worth catching is two correct ones between them hiding a row
   * neither meant to — so every combination below asserts on the JOINED path.
   */
  const files = [
    file('a', { bucket: 'To read' }),
    file('b', { bucket: 'Admin' }),
    file('c', { bucket: 'Admin', applicationIds: ['app-1'] }),
    file('d', { bucket: 'To read', applicationIds: ['app-1'] }),
  ]

  it('ANDs unfiled with the bucket chip', () => {
    expect(ids(visibleFiles(files, { ...OFF, bucket: 'Admin', unfiledOnly: true }))).toEqual(['b'])
  })

  it('ANDs unfiled with the keyword row', () => {
    const keywords = (id: string) => id === 'a' || id === 'c'
    expect(ids(visibleFiles(files, { ...OFF, unfiledOnly: true, keywords }))).toEqual(['a'])
  })

  it('ANDs unfiled with the search box', () => {
    const search = (f: VaultFile) => f.name.startsWith('b')
    expect(ids(visibleFiles(files, { ...OFF, unfiledOnly: true, search }))).toEqual(['b'])
  })

  it('can produce nothing at all, which is a state the list has to handle', () => {
    expect(visibleFiles(files, { ...OFF, bucket: 'Talks', unfiledOnly: true })).toEqual([])
  })

  it('lets a filed file through every other filter once unfiled is off', () => {
    // The guard that must not leak: turning the chip off has to restore `c`.
    expect(ids(visibleFiles(files, { ...OFF, bucket: 'Admin' }))).toEqual(['b', 'c'])
  })

  it('applies all four at once', () => {
    const shown = visibleFiles(files, {
      bucket: 'To read',
      unfiledOnly: true,
      keywords: (id) => id !== 'zz',
      search: (f) => f.name.endsWith('.pdf'),
    })
    expect(ids(shown)).toEqual(['a'])
  })
})

describe('counting the filters that are on', () => {
  it('ignores the search box, which explains itself', () => {
    expect(activeFilterCount({ bucket: 'all', unfiledOnly: false }, 0)).toBe(0)
  })

  it('counts each of the three that hide silently', () => {
    expect(activeFilterCount({ bucket: 'Admin', unfiledOnly: false }, 0)).toBe(1)
    expect(activeFilterCount({ bucket: 'all', unfiledOnly: true }, 0)).toBe(1)
    expect(activeFilterCount({ bucket: 'all', unfiledOnly: false }, 2)).toBe(1)
    expect(activeFilterCount({ bucket: 'Admin', unfiledOnly: true }, 3)).toBe(3)
  })
})
