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
import { keptOrDropped } from './posting-agent'

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
