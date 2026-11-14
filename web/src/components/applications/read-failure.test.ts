import { describe, expect, it } from 'vitest'
import { readFailureMessage } from '@/components/applications/read-failure'

describe('readFailureMessage', () => {
  it('names the kept page when the read failed after keeping it', () => {
    expect(readFailureMessage('The model did not answer', { name: 'rice.edu posting.html' })).toBe(
      'The model did not answer. rice.edu posting.html was saved to the Vault, so the page is not lost.',
    )
  })

  it('does not double a full stop the reason already has', () => {
    expect(readFailureMessage('Asked twice, with the same result.', { name: 'a.html' })).toBe(
      'Asked twice, with the same result. a.html was saved to the Vault, so the page is not lost.',
    )
  })

  it('says only the reason when nothing was kept', () => {
    expect(readFailureMessage('That page could not be opened.')).toBe(
      'That page could not be opened.',
    )
  })
})
