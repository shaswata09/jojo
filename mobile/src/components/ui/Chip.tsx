import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { Txt } from '@/components/ui/Text'
import type { LabelTone } from '@jojo/service/data/labels'
import type { Stage } from '@jojo/service/data/seed'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

export type ChipTone = LabelTone | 'neutral'

/**
 * A small labelled pill.
 *
 * Two shapes, and the difference is load-bearing: a squared chip is something
 * jojo assigned (a stage, a role tag), a capsule is a keyword the user chose.
 * Colour law says the loud pills belong to the user, so `neutral` is the
 * default and a tone has to be asked for.
 */
export function Chip({
  children,
  tone = 'neutral',
  stage,
  shape = 'squared',
  size = 'md',
  style,
}: {
  children: ReactNode
  tone?: ChipTone
  /** Paints the chip in a pipeline stage's own colour, dot included. */
  stage?: Stage
  shape?: 'squared' | 'capsule'
  size?: 'sm' | 'md'
  style?: StyleProp<ViewStyle>
}) {
  const c = useColors()

  const tones: Record<ChipTone, { bg: string; border: string; fg: string }> = {
    neutral: { bg: c.well, border: c.hairline, fg: c.text2 },
    gray: { bg: c.well, border: c.hairline, fg: c.text2 },
    teal: { bg: c.infoSoft, border: c.infoBorder, fg: c.info },
    amber: { bg: c.warningSoft, border: c.warningBorder, fg: c.warning },
    red: { bg: c.dangerSoft, border: c.dangerBorder, fg: c.danger },
    green: { bg: c.successSoft, border: c.successBorder, fg: c.success },
  }

  const skin = tones[tone]
  const stageColor = stage ? c.stage[stage] : undefined

  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: skin.bg,
          borderColor: skin.border,
          borderRadius: shape === 'capsule' ? radius.full : radius.sm,
          paddingVertical: size === 'sm' ? 2 : 3,
          paddingHorizontal: size === 'sm' ? space[1.5] : space[2],
        },
        style,
      ]}
    >
      {stageColor ? <View style={[styles.dot, { backgroundColor: stageColor }]} /> : null}
      {/* `numberOfLines` stops it wrapping; it does not stop it growing. Without
          the shrink the label keeps its full intrinsic width, the chip grows to
          match, and on a 250pt board column a long role or keyword runs straight
          out through the side of the card. */}
      <Txt size="xs" weight="medium" color={skin.fg} numberOfLines={1} style={s.shrink}>
        {children}
      </Txt>
    </View>
  )
}

/** The six-pixel stage marker on its own — a board column, a pipeline bar. */
export function StageDot({ stage, size = 7 }: { stage: Stage; size?: number }) {
  const c = useColors()
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.stage[stage],
      }}
    />
  )
}

/** Runtime health, as a dot. Green is on, amber is degraded, grey is off. */
export function StatusDot({ status }: { status: 'on' | 'warn' | 'off' }) {
  const c = useColors()
  const fill = status === 'on' ? c.success : status === 'warn' ? c.warning : c.text3
  return (
    <View style={[styles.dot, { backgroundColor: fill, width: 8, height: 8, borderRadius: 4 }]} />
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
    // The ceiling the label shrinks against. `alignSelf: 'flex-start'` sizes the
    // chip to its content, which is right until the content is wider than what
    // is holding it.
    maxWidth: '100%',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
})
