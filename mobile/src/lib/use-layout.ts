import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { space } from '@/theme/tokens'

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
 * Where a tablet stops being a big phone.
 *
 * 900dp is a landscape 10" tablet and up; a portrait one is ~800dp and a phone
 * on its side ~850dp, so both stay on the phone layout — which is right, since
 * neither has the width to run two useful columns of panels.
 */
const TWO_COLUMN = 900

/**
 * How wide the content is allowed to get, by layout.
 *
 * One column stops at 720 because past that a line of text is longer than the
 * eye can track back. Two columns may go to 1200, because the constraint there
 * is the width of a single column — 1200 split in two is ~590 each, which is
 * inside the same readable range. The web app makes the same trade with a
 * 1440px shell and `lg:grid-cols-2` inside it.
 */
const MAX_WIDTH = { 1: 720, 2: 1200 } as const

export type Layout = {
  width: number
  height: number
  landscape: boolean
  /** How many columns of panels the screen can carry. */
  columns: 1 | 2
  /** Horizontal padding: safe area, then centring, whichever is larger. */
  gutter: number
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const landscape = width > height
  const columns: 1 | 2 = width >= TWO_COLUMN ? 2 : 1
  // The safe area is asymmetric — the notch is on one side only — so the larger
  // of the two is used for both. Padding a row unevenly to match the hardware
  // is more distracting than the few points it saves.
  const safe = space[3] + Math.max(insets.left, insets.right)
  const centring = (width - MAX_WIDTH[columns]) / 2

  return { width, height, landscape, columns, gutter: Math.max(safe, centring) }
}
