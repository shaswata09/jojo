import { describe, expect, it } from 'vitest'
import source from './model-settings.tsx?raw'

/**
 * Q345 — NVIDIA was removed as a provider. The rule for what that means for
 * somebody who had already connected it is core's (`withoutRetired`,
 * `isRetiredServer`, tested in `core/provider.test.ts`); this pins that the web
 * app's settings loader actually applies it. Source read (D20).
 */
describe('a retired provider left in storage (Q345)', () => {
  it('clears a stored NVIDIA setting and its saved rows on load', () => {
    expect(source).toMatch(/const kept = withoutRetired\(stored, DEFAULTS\)/)
    expect(source).toMatch(/if \(kept !== stored\) writeStored\(STORAGE_KEY, JSON\.stringify\(DEFAULTS\)\)/)
    expect(source).toMatch(/!isRetiredServer\(v as ModelServer\)/)
  })
})
