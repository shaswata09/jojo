import { describe, expect, it, vi } from 'vitest'

vi.mock('@jojo/service/react/use-vault', () => ({ useVault: () => ({}) }))
vi.mock('@/lib/labels-context', () => ({ useLabels: () => ({}) }))
vi.mock('@/lib/toast-context', () => ({ useToast: () => ({}) }))
vi.mock('@/lib/vault-blobs', () => ({ useVaultBlobs: () => ({}) }))

const { undoDocument } = await import('./use-file-delete')

describe('undoDocument', () => {
  it('asks the store even when nothing was known to be stored', async () => {
    // The delete ran before the index hydrated: `has` said false, yet bytes
    // were trashed. The Undo has to ask for them back.
    const restore = vi.fn(async () => true)
    expect(await undoDocument(Promise.resolve(true), restore)).toBe('back')
    expect(restore).toHaveBeenCalled()
  })

  it('reports a loss only when bytes were taken and could not come back', async () => {
    expect(await undoDocument(Promise.resolve(true), async () => false)).toBe('lost')
  })

  it('says nothing for a record that never had a document', async () => {
    expect(await undoDocument(Promise.resolve(false), async () => false)).toBe('none')
  })
})
