import { describe, expect, it } from 'vitest'
import { buildBackup } from '@jojo/service/core/backup'
import { readPickedBackup } from './pick-backup'

/**
 * The defect this is written against: `await file.text()` with no `catch`.
 *
 * A `File` from an `<input>` is a reference to bytes on disk, and reading one
 * whose bytes have moved rejects with `NotReadableError`. The panel calls the
 * handler as `void onPickBackup(...)`, so that rejection went to the global
 * `unhandledrejection` listener and the user saw nothing happen at all — on the
 * one screen where "nothing happened" and "your backup was refused" have to be
 * told apart.
 */

/** A `File` for a function that only ever reads it. */
const chosen = (text: () => Promise<string>): FileList => [{ text }] as unknown as FileList

const goodBackup = () =>
  JSON.stringify(
    buildBackup({
      exportedAt: '2026-08-22T10:00:00.000Z',
      nodes: [],
      edges: [],
      documents: [],
    }),
  )

describe('reading a chosen backup', () => {
  it('stages a plan for a file it wrote itself', async () => {
    const picked = await readPickedBackup(chosen(() => Promise.resolve(goodBackup())))
    expect(picked.kind).toBe('plan')
    if (picked.kind !== 'plan') return
    expect(picked.plan.exportedAt).toBe('2026-08-22T10:00:00.000Z')
  })

  it('says nothing when the picker was cancelled', async () => {
    expect((await readPickedBackup(null)).kind).toBe('none')
    expect((await readPickedBackup([] as unknown as FileList)).kind).toBe('none')
  })

  it('refuses a file that is not a backup, in the validator words', async () => {
    const picked = await readPickedBackup(chosen(() => Promise.resolve('{"hello":1}')))
    expect(picked.kind).toBe('refused')
    if (picked.kind !== 'refused') return
    expect(picked.description).toContain('not written by jojo')
    expect(picked.description).toContain('Nothing has been changed')
  })

  it('resolves rather than rejecting when the bytes will not read', async () => {
    // The reproduction. Chrome throws exactly this after a file is moved,
    // renamed or unplugged between the picker and the read.
    const gone = new Error('The requested file could not be read')
    gone.name = 'NotReadableError'

    // No `rejects` matcher here on purpose: an `await` that throws is the
    // failure, and this has to be the assertion that catches it.
    const picked = await readPickedBackup(chosen(() => Promise.reject(gone)))

    expect(picked.kind).toBe('unreadable')
    if (picked.kind !== 'unreadable') return
    // Carried out whole, because `reportError` is what puts it in the crash log
    // and a stringified message there is a bug nobody can chase.
    expect(picked.thrown).toBe(gone)
    expect(picked.title).not.toBe('')
    expect(picked.description).toContain('Nothing has been changed')
  })

  it('does not blame the file when the disk is what failed', async () => {
    // Two different actions: replace the file, versus go and find it. Copy that
    // called this "cannot be restored" would send someone hunting for another
    // backup they do not have.
    const unreadable = await readPickedBackup(chosen(() => Promise.reject(new Error('nope'))))
    const refused = await readPickedBackup(chosen(() => Promise.resolve('not json at all')))
    if (unreadable.kind !== 'unreadable' || refused.kind !== 'refused') {
      throw new Error('the two failures did not come back as two failures')
    }
    expect(unreadable.title).not.toBe(refused.title)
  })
})
