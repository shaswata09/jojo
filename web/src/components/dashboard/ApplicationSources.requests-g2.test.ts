/**
 * Q040: "Where they came from" opens on the donut. (The Applications half of
 * the same request — the board before the table — is held in
 * `routes/Applications.requests.test.ts`.)
 *
 * The initial view is a `useState` inside the component, so D20 leaves a
 * narrow source read.
 */

import { describe, expect, it } from 'vitest'
import source from './ApplicationSources.tsx?raw'

describe('Q040 — the sources card defaults to the donut', () => {
  it('starts its view state on the donut', () => {
    expect(source).toMatch(/const \[view, setView\] = useState<View>\('donut'\)/)
  })
})
