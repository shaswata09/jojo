import { describe, expect, it } from 'vitest'
import source from './LocalModelPanel.tsx?raw'

/**
 * Owner request Q172: NVIDIA's Test connection must not reset the form, and
 * re-entering a key must not show "Connected" until a test succeeds.
 *
 * Both are React state transitions in the panel, so (D20) they are pinned on
 * its source. The third part of the request — no GET with a body — is pinned
 * behaviourally in `lib/reader-relay.test.ts` ("a relayed GET carries no body")
 * and `core/model-server.test.ts`.
 */

/** `onTest`'s failure branch: from `if (!result.ok) {` to its `return`. */
const failureBranch = (() => {
  const start = source.indexOf('const onTest = async () => {')
  const branch = source.indexOf('if (!result.ok) {', start)
  const end = source.indexOf('return\n', branch)
  return start < 0 || branch < 0 || end < 0 ? '' : source.slice(branch, end)
})()

/** The API key Field's own JSX. */
const keyField = /<Field\s+label=\{t\('model\.apiKey\.label'\)\}[\s\S]*?\/>/.exec(source)?.[0] ?? ''

describe('Q172 — testing a connection', () => {
  it('reads the failure branch it means to', () => {
    expect(failureBranch).toContain('setTested(false)')
  })

  it('keeps the model the person typed when the test fails', () => {
    expect(failureBranch).not.toMatch(/setModel\(/)
    expect(failureBranch).not.toMatch(/save\(/)
  })

  it('calls the card connected only after a successful test', () => {
    expect(source).toContain('const connected = tested === true')
  })

  it('forgets the last verdict the moment a key is typed', () => {
    expect(keyField).toMatch(/onChange=\{\(e\) => \{[\s\S]*?setTested\(null\)/)
  })
})
