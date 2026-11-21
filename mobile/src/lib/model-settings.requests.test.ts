/**
 * Q345 — NVIDIA was removed as a provider. The rule is core's (`withoutRetired`,
 * `isRetiredServer`, tested in `core/provider.test.ts`); this pins that the
 * phone's settings loader applies it. The file imports React Native, which
 * this runner does not load, so it is read as text.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'model-settings.tsx'),
  'utf8',
)

describe('a retired provider left in storage (Q345)', () => {
  it('clears a stored NVIDIA setting and its saved rows on load, on the phone too', () => {
    expect(source).toMatch(/const kept = withoutRetired\(parsed, DEFAULTS\)/)
    expect(source).toMatch(/if \(kept !== parsed\) void AsyncStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(DEFAULTS\)\)/)
    expect(source).toMatch(/!isRetiredServer\(v as ModelServer\)/)
  })
})
