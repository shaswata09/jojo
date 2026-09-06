import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { space } from '@/theme/tokens'
import { layoutFor } from '@/lib/layout-math'
import type { LayoutResult } from '@/lib/layout-math'

/** Re-exported so callers keep importing the layout type from the hook. */
export type Layout = LayoutResult

/**
 * The one place that knows how wide the app is right now.
 *
 * The app is unlocked for rotation, so every dimension here has to be read at
 * render time. `useWindowDimensions` re-renders on rotation; `Dimensions.get`
 * does not — it answers with whatever was true when the module was first
 * evaluated, which is the classic way a rotated app ends up drawing a portrait
 * layout on a landscape screen. Nothing in this codebase may call it.
 *
 * Two things change when the phone turns:
 *
 * **The notch moves to the side.** In portrait the unsafe area is top and
 * bottom; in landscape it is left or right, depending which way you turned.
 * `insets.left/right` are zero in portrait and non-zero in landscape, so
 * folding them into the gutter is free in portrait and load-bearing in
 * landscape.
 *
 * **Lines get too long to read.** A phone in landscape is ~850dp wide. Text set
 * across all of it is past the point where the eye can find the start of the
 * next line. Rather than give every screen a max-width wrapper — which would
 * fight the calendar grid and the board's horizontal scroller — the extra width
 * is absorbed into the side gutters, so content stays centred and every
 * percentage- and flex-based layout inside it keeps working untouched.
 */

/**
 * The arithmetic lives in `layout-math.ts`, where a test can reach it. This is
 * the two readings it needs, and nothing else.
 *
 * `maxColumns` is what the CALLING SCREEN draws, not what the device could
 * carry — the two used to be the same value and that was the bug: a screen
 * rendering one column on a tablet was given the two-column width cap, so its
 * content ran to 1042dp instead of stopping at a readable 720. See the header of
 * `layout-math.ts` for the measurement.
 */
export function useLayout(maxColumns: 1 | 2 = 1): Layout {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  return layoutFor({
    width,
    height,
    insetLeft: insets.left,
    insetRight: insets.right,
    basePadding: space[3],
    maxColumns,
  })
}
