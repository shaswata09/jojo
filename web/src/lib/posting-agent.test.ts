/**
 * Whether a posting's page counts as kept.
 *
 * The record is written first and the bytes second. A failed byte write used
 * to be ignored: the record stayed, `postingSourceForUrl` counted the address
 * as kept for ever, and the scout never fetched the page again. The line that
 * decides is `keptOrDropped`; the hooks around it cannot be mounted here.
 */

import { describe, expect, it, vi } from 'vitest'
import type { VaultFile } from '@jojo/service/data/vault'
import {
  NOTHING_TO_READ_WITH,
  NO_BACKGROUND_ROUTE,
  keptOrDropped,
  reusablePage,
  withoutExtension,
} from './posting-agent'

const file = { id: 'file_1', name: 'Rice — Assistant Professor.html' } as VaultFile

describe('keptOrDropped', () => {
  it('keeps a page whose bytes landed', () => {
    const removeFile = vi.fn()
    expect(keptOrDropped({ file, stored: true }, removeFile)).toBe(file)
    expect(removeFile).not.toHaveBeenCalled()
  })

  it('takes the record back out when the bytes did not, so a retry can fetch it', () => {
    const removeFile = vi.fn()
    expect(keptOrDropped({ file, stored: false }, removeFile)).toBeNull()
    expect(removeFile).toHaveBeenCalledWith('file_1')
  })
})

describe('reusablePage', () => {
  const files = [file, { id: 'file_2', name: 'Other.html' } as VaultFile]

  it('reuses the kept page when its bytes are on this device', () => {
    expect(reusablePage('file_1', files, () => true)).toBe(file)
  })

  it('does not reuse a record whose bytes are not here — the fresh read is kept (R17)', () => {
    expect(reusablePage('file_1', files, (id) => id !== 'file_1')).toBeUndefined()
  })

  it('reuses nothing when nothing is kept for the address', () => {
    expect(reusablePage(undefined, files, () => true)).toBeUndefined()
  })
})

/*
 * Round 3: MarkItDown follows redirects and nothing here sees the hops, so a
 * board-listed address that 302s to `http://127.0.0.1:…` was read, sent to the
 * model and filed. A read nobody asked for goes through the extension or not
 * at all.
 */
describe('withoutExtension', () => {
  it('never hands an unattended read to the document reader', () => {
    expect(withoutExtension('http://127.0.0.1:3001/mcp', true)).toEqual({
      reason: NO_BACKGROUND_ROUTE,
    })
    expect(withoutExtension('', true)).toEqual({ reason: NO_BACKGROUND_ROUTE })
  })

  it('uses the reader for a posting a person opened, when it is set up', () => {
    expect(withoutExtension('http://127.0.0.1:3001/mcp', false)).toEqual({
      reader: 'http://127.0.0.1:3001/mcp',
    })
    expect(withoutExtension('  ', false)).toEqual({ reason: NOTHING_TO_READ_WITH })
  })
})
