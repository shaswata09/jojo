import { useMemo } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { comparisonsFor, MIN_ARM, rangeLabel } from '@jojo/service/core/segments'
import type { Arm, Comparison } from '@jojo/service/core/segments'
import { useApplications } from '@/lib/store-context'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'

/**
 * Which parts of the search are doing better, and whether that means anything.
 *
 * The phone's half of web's `statistics/WhatIsWorking.tsx`, and the band is the
 * point of it there too: a bar showing "80% against 12%" off four records a
 * side looks exactly like one off four hundred. The band is the Wilson interval
 * and the line is the measured rate, so the uncertainty is the first thing seen
 * rather than a footnote.
 *
 * The unconfident groups are shown rather than hidden for the reason the web
 * file gives — "we cannot tell yet" is worth knowing — and the verdict line
 * under each group is what stops the two reading the same.
 */

/**
 * A percentage in the shape React Native's `DimensionValue` insists on.
 *
 * `${number}%`, not `string` — RN types positional percentages as a template
 * literal, so `String(n) + '%'` is rejected. A helper rather than a cast at
 * three call sites.
 */
const pct = (n: number): `${number}%` => `${n}%`

function Row({ arm, leader }: { arm: Arm; leader: boolean }) {
  const { t } = useTranslation('components')
  const c = useColors()
  const low = arm.interval.low * 100
  const width = Math.max(arm.interval.high * 100 - low, 1)

  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space[2] }}>
        <Txt size="sm" weight={leader ? 'medium' : 'regular'} style={{ flexShrink: 1 }}>
          {arm.label}
        </Txt>
        <Txt size="xs" tone="secondary">
          {t('working.arm', {
            count: arm.count,
            of: arm.of,
            rate: arm.rate,
            range: rangeLabel(arm),
          })}
        </Txt>
      </View>

      <View style={{ height: 10, borderRadius: 5, backgroundColor: c.well, overflow: 'hidden' }}>
        {/* Where the true rate plausibly sits. */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: pct(low),
            width: pct(width),
            borderRadius: 5,
            backgroundColor: leader ? c.accent : c.text3,
            opacity: leader ? 0.35 : 0.2,
          }}
        />
        {/* The measured rate, inside its own band so it never reads as the
            whole answer. */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: pct(arm.rate),
            width: 2,
            backgroundColor: leader ? c.accent : c.text2,
          }}
        />
      </View>
    </View>
  )
}

function Group({ c }: { c: Comparison }) {
  const { t } = useTranslation('components')
  const domain = useDomain()
  return (
    <View style={{ gap: space[2] }}>
      <Txt size="sm" weight="medium">
        {c.measure === 'replied'
          ? t('working.repliesBy', { dimension: domain.dimension(c.dimension) })
          : t('working.interviewsBy', { dimension: domain.dimension(c.dimension) })}
      </Txt>
      <View style={{ gap: space[2.5] }}>
        {c.arms.map((arm) => (
          <Row key={arm.label} arm={arm} leader={c.confident && arm.label === c.best.label} />
        ))}
      </View>
      <Txt size="xs" tone="muted">
        {c.confident
          ? // As stored, not lowercased: an arm is a source or a role tag, a name
            // the person wrote, and lowercasing it breaks a German noun.
            t('working.confident', { best: c.best.label })
          : t('working.overlap')}
        {c.tooFew > 0 ? ` ${t('working.tooFew', { count: c.tooFew, min: MIN_ARM })}` : ''}
      </Txt>
    </View>
  )
}

export function WhatIsWorking() {
  const { t } = useTranslation('components')
  const { all } = useApplications()
  const comparisons = useMemo(() => comparisonsFor(all), [all])

  // Silence is the right output for a young search.
  if (comparisons.length === 0) return null

  return (
    <Panel>
      <PanelTitle hint={t('working.hint')}>{t('working.title')}</PanelTitle>
      <View style={{ gap: space[5] }}>
        {comparisons.map((c) => (
          <Group key={`${c.dimension}:${c.measure}`} c={c} />
        ))}
      </View>
    </Panel>
  )
}
