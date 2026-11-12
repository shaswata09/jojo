/**
 * When a download's blob URL is let go.
 *
 * Next-task revokes (`setTimeout(…, 0)`) were the rule in four files; Firefox
 * resolves a download's blob URL asynchronously, so a large backup could be
 * revoked before it was read and arrive empty while `lastBackupAt` said the
 * person was safe. One helper now, and it waits.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { REVOKE_AFTER_MS, revokeLater } from './save-file'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('revokeLater', () => {
  it('keeps the URL alive well past the next task, then releases it', () => {
    vi.useFakeTimers()
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    revokeLater('blob:x')
    vi.advanceTimersByTime(1000)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_AFTER_MS)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })

  it('waits at least thirty seconds by default', () => {
    expect(REVOKE_AFTER_MS).toBeGreaterThanOrEqual(30_000)
  })
})
