/**
 * The cell the profile banner reads its explicit requests from.
 *
 * Small, and tested because its one subtlety is the kind that hides: a request
 * that fires listeners when nothing changed makes the banner re-render on every
 * click of a menu that was already open on that document.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearProfileRead,
  profileReadRequest,
  requestProfileRead,
  subscribeProfileRead,
} from './profile-read-request'

afterEach(() => clearProfileRead())

describe('asking for a document to be read', () => {
  it('holds the request until it is cleared', () => {
    requestProfileRead({ fileId: 'f1', name: 'CV.pdf' })
    expect(profileReadRequest()).toEqual({ fileId: 'f1', name: 'CV.pdf' })
    clearProfileRead()
    expect(profileReadRequest()).toBeNull()
  })

  it('replaces a standing request rather than queueing behind it', () => {
    requestProfileRead({ fileId: 'f1', name: 'CV.pdf' })
    requestProfileRead({ fileId: 'f2', name: 'Statement.pdf' })
    expect(profileReadRequest()?.fileId).toBe('f2')
  })

  it('tells subscribers exactly when something changed, and not otherwise', () => {
    let calls = 0
    const stop = subscribeProfileRead(() => {
      calls += 1
    })
    requestProfileRead({ fileId: 'f1', name: 'CV.pdf' })
    requestProfileRead({ fileId: 'f1', name: 'CV.pdf' }) // the same again: silence
    clearProfileRead()
    clearProfileRead() // already clear: silence
    stop()
    requestProfileRead({ fileId: 'f1', name: 'CV.pdf' }) // unsubscribed: silence
    expect(calls).toBe(2)
  })
})
