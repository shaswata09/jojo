import { describe, expect, it } from 'vitest'
import { MIN_SHEET_WIDTH, maxWidthFor } from '@/lib/sheet-width'
import { widthForKey } from '@/components/applications/detail/resizer-keys'

describe('widthForKey', () => {
  const viewport = 1440

  it('sends Home to the minimum and End to the maximum, as aria-valuemin/max', () => {
    expect(widthForKey('Home', 600, viewport, false)).toBe(MIN_SHEET_WIDTH)
    expect(widthForKey('End', 600, viewport, false)).toBe(maxWidthFor(viewport))
    expect(MIN_SHEET_WIDTH).toBeLessThan(maxWidthFor(viewport))
  })

  it('resets on Enter and ignores keys it does not own', () => {
    expect(widthForKey('Enter', 600, viewport, false)).toBe('reset')
    expect(widthForKey('a', 600, viewport, false)).toBeNull()
  })
})
