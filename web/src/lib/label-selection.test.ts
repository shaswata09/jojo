/**
 * The providers that apply the lit rule, checked as source text.
 *
 * The rule itself is unit-tested beside it in `kg/core/label-selection`. This
 * file exists because the rule on its own is not enough: verification caught
 * the service tests passing in full while `matches` had been reverted to read
 * the raw selection, since nothing there mounts a provider (D20).
 *
 * Both apps are asserted here rather than one each, because the failure this
 * catches is precisely the two of them drifting apart — mobile shipped the raw
 * selection for weeks while web carried the fix, and each file was a copy of
 * the other. A source-text check is coarse; it is what is available, and it
 * would have caught that.
 */

import { describe, expect, it } from 'vitest'
import webLabels from './labels.tsx?raw'
import mobileLabels from '../../../mobile/src/lib/labels.tsx?raw'

describe.each([
  ['web', webLabels],
  ['mobile', mobileLabels],
])('%s LabelsProvider', (_name, source) => {
  it('derives the lit set from the keywords that still exist', () => {
    expect(source).toMatch(/litSelection\(\s*selected\s*,\s*labels\s*\)/)
  })

  it('filters on the lit set, never on the raw selection', () => {
    const matches = source.slice(source.indexOf('const matches'))
    expect(matches).toMatch(/lit\.size === 0 \|\| carries\(recordId, lit\)/)
    expect(matches.slice(0, 200)).not.toMatch(/carries\(recordId, selected\)/)
  })

  it('publishes the lit set as `selected`, so a dead chip cannot render', () => {
    expect(source).toMatch(/selected: lit/)
  })
})
