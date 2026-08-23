/**
 * Two opens have to be two mounts.
 *
 * D20 forbids jsdom and testing-library, so nothing here mounts `DialogHost` —
 * which is why the defect this covers survived a 362-test suite. What is
 * assertable without a DOM is the rule the host renders through: the KEY it
 * hands React. The sequences below are the two the browser reproduced, written
 * as the open requests the provider mints for them.
 */

import { describe, expect, it } from 'vitest'
import type { OpenDialog } from '@/lib/dialogs-context'
import dialogsSource from '@/lib/dialogs.tsx?raw'
import { NO_MOUNT, mountKey, nextMount } from './dialog-mount'

/** What `open('application', …)` puts in state — a NEW object per call. */
const opening = (props: Record<string, unknown> = {}): OpenDialog => ({
  name: 'application',
  props,
})

describe('nextMount', () => {
  /**
   * The reproduction, minus the browser: fill the form, dismiss it, open a
   * blank one, then press the Undo still sitting in the toast stack. Both opens
   * are `application:new`, so the key alone was `application:new` twice and
   * React kept the blank instance with its lazily-initialised fields.
   */
  it('gives a second open of the same dialog a different key', () => {
    const blank = nextMount(NO_MOUNT, opening())
    const restored = nextMount(blank, opening({ initial: { org: 'ZetaCo' } }))

    expect(mountKey('application:new', blank)).not.toBe(mountKey('application:new', restored))
  })

  /**
   * The edit variant, which the audit asserted by construction rather than
   * driving: same code path, same key shape, and "Changes discarded · Undo" is
   * reachable with the same record's dialog already open.
   */
  it('gives a second open of the same RECORD a different key', () => {
    const first = nextMount(NO_MOUNT, opening({ mode: 'edit', id: 'app:rice' }))
    const second = nextMount(
      first,
      opening({ mode: 'edit', id: 'app:rice', initial: { note: 'edited' } }),
    )

    expect(mountKey('application:app:rice', first)).not.toBe(
      mountKey('application:app:rice', second),
    )
  })

  /**
   * The other half of the rule, and the reason the counter is not simply bumped
   * per render. A dialog that remounts while it is open loses everything typed
   * into it — the same data loss as the bug, arriving from the fix.
   */
  it('keeps the same key while one open request stays on screen', () => {
    const request = opening()
    const mount = nextMount(NO_MOUNT, request)

    // Three unrelated re-renders of the host: same request object, same mount.
    const again = nextMount(nextMount(nextMount(mount, request), request), request)

    expect(again).toBe(mount)
    expect(mountKey('application:new', again)).toBe(mountKey('application:new', mount))
  })

  it('separates two dialogs opened over one another by identity as well as by name', () => {
    const application = nextMount(NO_MOUNT, opening())
    const draft = nextMount(application, { name: 'draft', props: {} })

    expect(mountKey('application:new', application)).not.toBe(mountKey('draft:new', draft))
  })

  it('advances across a close, so a reopen in the same batch is a fresh mount', () => {
    // `close()` then `open()` inside one event handler: React processes both
    // updates before rendering, so the host never sees the null in between.
    const first = nextMount(NO_MOUNT, opening())
    const closed = nextMount(first, null)
    const reopened = nextMount(closed, opening())

    expect(mountKey('application:new', reopened)).not.toBe(mountKey('application:new', first))
  })
})

/**
 * The rule above is only worth anything if the host actually renders through it.
 *
 * Everything above this line pins `mountKey` in isolation, and every one of
 * those cases stayed green when the three `key=` props in `DialogHost` were put
 * back to the bare `application:${id ?? 'new'}` form that caused the defect —
 * the helper was proven while the code that has to use it was not observed at
 * all. That is the same shape as the `opsSeq` regression, whose test asserted
 * the store's behaviour through a helper that hardcoded the value under test,
 * so the bug it was written for could be reintroduced against a green suite.
 *
 * D20 forbids jsdom, so `DialogHost` cannot be mounted; the source is what is
 * assertable. `popover.test.ts` pins its own call site the same way.
 */
describe('DialogHost', () => {
  it('routes every mounted dialog key through mountKey', () => {
    const keys = [...dialogsSource.matchAll(/key=\{([^}]*(?:\}[^}]*)*?)\}\s*\n/g)].map((m) =>
      m[1].trim(),
    )

    // If this ever reads 0, the regex has drifted rather than the bug being
    // fixed — an empty `every()` passes and would hide exactly this defect.
    // Four since 'Application from a link' joined the host.
    expect(keys.length).toBe(4)
    for (const key of keys) expect(key).toMatch(/^mountKey\(/)
  })

  it('passes the live mount to each of them, not a constant', () => {
    // `mountKey(identity, NO_MOUNT)` would typecheck, satisfy the test above,
    // and reinstate the defect in full: one key for every open.
    const calls = [...dialogsSource.matchAll(/mountKey\([^,]+,\s*([A-Za-z_$][\w$]*)\s*\)/g)]

    expect(calls.length).toBe(4)
    for (const call of calls) expect(call[1]).toBe('showing')
  })
})
