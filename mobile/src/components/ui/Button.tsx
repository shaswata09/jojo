import { Feather } from '@expo/vector-icons'
import { Pressable, StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { Txt } from '@/components/ui/Text'
import type { FeatherName } from '@/lib/timeline-visuals'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space, type } from '@/theme/tokens'

export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = {
  label: string
  onPress?: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: FeatherName
  /** Names why the button cannot be pressed. Shown under it — never silent. */
  blocker?: string
  disabled?: boolean
  full?: boolean
  style?: StyleProp<ViewStyle>
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 50 }
const PAD: Record<ButtonSize, number> = { sm: space[3], md: space[4], lg: space[5] }
const FONT: Record<ButtonSize, keyof typeof type> = { sm: 'sm', md: 'base', lg: 'base' }
const ICON: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 17 }

/**
 * One button, four variants.
 *
 * A disabled button always says why. The web app enforces this with a `title`
 * on every greyed control; there are no tooltips on a touch screen, so the
 * reason is rendered as a line under the button instead — which is the only
 * place a finger user would ever find it.
 */
export function Button({
  label,
  onPress,
  variant = 'default',
  size = 'sm',
  icon,
  blocker,
  disabled,
  full,
  style,
}: ButtonProps) {
  const c = useColors()
  const off = Boolean(disabled || blocker)

  const fills: Record<ButtonVariant, { bg: string; border: string; fg: string }> = {
    default: { bg: c.accent, border: c.accent, fg: c.accentFg },
    outline: { bg: 'transparent', border: c.hairlineStrong, fg: c.text1 },
    ghost: { bg: 'transparent', border: 'transparent', fg: c.text2 },
    destructive: { bg: c.dangerSoft, border: c.dangerBorder, fg: c.danger },
  }
  const skin = fills[variant]

  return (
    <View style={[full && styles.full, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: off }}
        accessibilityHint={blocker}
        disabled={off}
        onPress={onPress}
        style={({ pressed }) => [
          styles.base,
          {
            height: HEIGHT[size],
            paddingHorizontal: PAD[size],
            backgroundColor: skin.bg,
            borderColor: skin.border,
            opacity: off ? 0.45 : 1,
            // Feedback belongs on press-down, not on release: the moment lag
            // appears, directness falls off a cliff.
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
      >
        {icon ? <Feather name={icon} size={ICON[size]} color={skin.fg} /> : null}
        {/* Same reasoning as the chip: a one-line label still grows the button
            to fit it unless it is allowed to shrink. */}
        <Txt size={FONT[size]} weight="medium" color={skin.fg} numberOfLines={1} style={s.shrink}>
          {label}
        </Txt>
      </Pressable>

      {blocker ? (
        <Txt size="xs" tone="muted" style={{ marginTop: space[1] }}>
          {blocker}
        </Txt>
      ) : null}
    </View>
  )
}

/**
 * A square control carrying only an icon.
 *
 * Drawn at 44pt whatever the glyph inside measures — the web version reaches
 * this with an invisible catch area around a 28px button, which is a fix for a
 * pointer-first layout this one does not have.
 */
export function IconButton({
  icon,
  onPress,
  label,
  tone,
  active,
  disabled,
  size = 40,
  style,
}: {
  icon: FeatherName
  onPress?: () => void
  /** The accessible name. An icon alone says nothing. */
  label: string
  tone?: 'default' | 'danger'
  active?: boolean
  disabled?: boolean
  size?: number
  style?: StyleProp<ViewStyle>
}) {
  const c = useColors()
  const fg = disabled ? c.text3 : tone === 'danger' ? c.danger : active ? c.accent : c.text2

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected: active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.icon,
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: active ? c.accentSoft : pressed ? c.rowHover : 'transparent',
          borderColor: active ? c.accentBorder : 'transparent',
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Feather name={icon} size={17} color={fg} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  full: { alignSelf: 'stretch' },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
})
