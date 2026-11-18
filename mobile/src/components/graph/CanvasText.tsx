import { Text } from 'react-native'
import { fonts } from '@/theme/tokens'

/** Room a name may take; anything wider is cut with an ellipsis. */
const BOX = 300

/**
 * A name on a graph canvas, as a native text view placed over the SVG.
 *
 * Not `react-native-svg`'s `<Text>`: on Android it lays glyphs out one by one,
 * left to right, with no bidi and no joining, so "غير مرتبط بأي شيء" came out
 * reversed and in isolated letter forms (measured on the emulator). A native
 * text view shapes every script the phone can show. `x, y` mean what they mean
 * in SVG — the anchor point and the baseline — so the label picker's
 * placements carry over; `anchor` is physical (the canvas frame is
 * left-to-right in every language, and the picture is mirrored for Arabic by
 * the layout instead).
 */
export function CanvasText({
  x,
  y,
  anchor,
  size,
  color,
  halo,
  weight = 'regular',
  children,
}: {
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  size: number
  color: string
  /** A soft outline in the canvas colour, so a name over lines stays legible. */
  halo?: string
  weight?: 'regular' | 'medium' | 'semibold'
  children: string
}) {
  const left = anchor === 'middle' ? x - BOX / 2 : anchor === 'start' ? x : x - BOX
  return (
    <Text
      numberOfLines={1}
      accessible={false}
      importantForAccessibility="no"
      style={{
        position: 'absolute',
        left,
        top: y - size * 1.08,
        width: BOX,
        fontFamily: fonts[weight],
        fontSize: size,
        lineHeight: size * 1.35,
        includeFontPadding: false,
        color,
        textAlign: anchor === 'middle' ? 'center' : anchor === 'start' ? 'left' : 'right',
        ...(halo
          ? {
              textShadowColor: halo,
              textShadowRadius: 3,
              textShadowOffset: { width: 0, height: 0 },
            }
          : null),
      }}
    >
      {children}
    </Text>
  )
}
