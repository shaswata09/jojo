import { Feather } from '@react-native-vector-icons/feather/static'
import { I18nManager } from 'react-native'
import type { StyleProp, TextStyle } from 'react-native'
import { mirrorFor } from '@/lib/directional'
import type { FeatherName } from '@/lib/timeline-visuals'

/**
 * A Feather glyph that turns round in a right-to-left layout when it points
 * somewhere (see `lib/directional.ts`). Every other glyph draws as Feather's.
 *
 * Read once per draw rather than cached: `forceRTL` takes effect on the next
 * launch, and `isRTL` is a constant for the life of this one.
 */
export function Icon({
  name,
  size,
  color,
  style,
}: {
  name: FeatherName
  size: number
  color: string
  style?: StyleProp<TextStyle>
}) {
  const mirror = mirrorFor(name, I18nManager.isRTL)
  return <Feather name={name} size={size} color={color} style={mirror ? [style, mirror] : style} />
}
