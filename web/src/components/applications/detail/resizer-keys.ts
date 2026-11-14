import { MIN_SHEET_WIDTH, maxWidthFor, nudgeWidth } from '@/lib/sheet-width'

/**
 * What a key does to the record sheet's width, kept out of the component so the
 * mapping is assertable.
 *
 * Home is `aria-valuemin` and End `aria-valuemax`, per the APG separator
 * pattern: the separator's value is the sheet's width, so Home is the narrowest.
 * They were the other way round, and a screen reader announced the value moving
 * opposite to the key.
 *
 * `null` for a key the separator does not handle, `'reset'` for Enter.
 */
export function widthForKey(
  key: string,
  width: number,
  viewport: number,
  coarse: boolean,
): number | 'reset' | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      return nudgeWidth(width, key === 'ArrowLeft' ? -1 : 1, viewport, coarse)
    case 'Home':
      return MIN_SHEET_WIDTH
    case 'End':
      return maxWidthFor(viewport)
    case 'Enter':
      return 'reset'
    default:
      return null
  }
}
