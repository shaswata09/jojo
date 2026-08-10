import { StyleSheet } from 'react-native'
import { radius, space } from '@/theme/tokens'

/**
 * The style fragments that were being retyped in every file.
 *
 * `fill` in particular appeared in twenty-three of them — `flex: 1` alone is
 * not enough in React Native, because a flex child's minimum size is its
 * content, so a long unbroken title pushes the row wider than the screen
 * instead of truncating. `minWidth: 0` is what makes `numberOfLines` work
 * inside a row, and it is the single easiest thing to forget.
 *
 * Only genuinely cross-cutting shapes live here. A style used by one screen
 * belongs to that screen: a shared stylesheet that accumulates one-offs is how
 * you end up unable to change anything.
 */
export const s = StyleSheet.create({
  /** A flex child that may truncate. See the note above. */
  fill: { flex: 1, minWidth: 0 },

  /**
   * Allowed to be squeezed, but not to claim space it does not need.
   *
   * The difference from `fill`: `flex: 1` makes a child *take* the free room,
   * which is wrong for a chip or a button label — they should be their natural
   * width and only give way when the row runs out. Yoga defaults `flexShrink`
   * to 0, the opposite of the web, so without this they never give way at all
   * and simply overflow the card.
   */
  shrink: { flexShrink: 1, minWidth: 0 },

  /** A horizontal run of chips or buttons that wraps rather than overflowing. */
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[1.5] },

  /** A left-to-right row with the app's standard gap. */
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },

  /** A row whose items align to their tops — a title beside a two-line block. */
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },

  /** Struck through, for anything ticked off. */
  struck: { textDecorationLine: 'line-through' },

  /** A full-width status banner — the scout's and the assistant's. */
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
})
