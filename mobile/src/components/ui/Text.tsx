import { Text as RNText } from 'react-native'
import type { TextProps, TextStyle } from 'react-native'
import { useTone } from '@/theme/tone'
import type { Tone } from '@/theme/tone'
import { fonts, lineHeight, type } from '@/theme/tokens'

type Size = keyof typeof type
type Weight = 'regular' | 'medium' | 'semibold' | 'bold'

/**
 * The text ramp, in one place.
 *
 * Every screen was otherwise going to repeat `fontFamily`, `fontSize` and a
 * colour lookup on each label, which is how a type scale quietly turns into
 * fourteen arbitrary sizes. `tone` names the *role* rather than the hex, so a
 * palette change reaches every string in the app without touching a screen.
 */
export type { Tone }

export type TxtProps = TextProps & {
  size?: Size
  weight?: Weight
  mono?: boolean
  tone?: Tone
  /** Escape hatch for a colour that comes from data — a stage, a chart series. */
  color?: string
  center?: boolean
  uppercase?: boolean
  /**
   * Marks this string as a heading for TalkBack and VoiceOver.
   *
   * The phone app had no `accessibilityRole="header"` anywhere across 85
   * component files, so both screen readers' heading rotors were empty on every
   * screen — there was no way to skim a screen structurally, which is the
   * mobile equivalent of a web page with no `<h1>`. The web app's heading
   * structure is careful; this is the same care, in the vocabulary the phone
   * uses.
   *
   * A prop rather than a size rule: `xl` is a screen title in one place and a
   * figure in a stat tile in another, and only one of those is a heading.
   */
  heading?: boolean
}

export function Txt({
  size = 'base',
  weight = 'regular',
  mono,
  tone = 'primary',
  color,
  center,
  uppercase,
  heading,
  style,
  ...rest
}: TxtProps) {
  const toneColor = useTone(tone)

  const base: TextStyle = {
    fontFamily: mono ? fonts.mono : fonts[weight],
    fontSize: type[size],
    lineHeight: lineHeight[size],
    color: color ?? toneColor,
  }
  if (center) base.textAlign = 'center'
  if (uppercase) {
    base.textTransform = 'uppercase'
    base.letterSpacing = 0.6
  }
  // Tracking is bound to the size rather than to the element — optical
  // letter-spacing runs the other way from size, so it belongs on the step.
  if (size === 'xl') base.letterSpacing = -0.3
  if (size === 'xxl') base.letterSpacing = -0.6

  return (
    <RNText
      {...(heading === true ? { accessibilityRole: 'header' as const } : {})}
      {...rest}
      style={[base, style]}
    />
  )
}
