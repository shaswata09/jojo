import { useMemo } from 'react'
import { View } from 'react-native'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { comparisonsFor, MIN_ARM, rangeLabel } from '@jojo/service/core/segments'
import type { Arm, Comparison } from '@jojo/service/core/segments'
import { useApplications } from '@/lib/store-context'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

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
          {arm.count} of {arm.of} · {arm.rate}% · likely {rangeLabel(arm)}
        </Txt>
      </View>

      <View
        style={{ height: 10, borderRadius: 5, backgroundColor: c.well, overflow: 'hidden' }}
      >
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
  return (
    <View style={{ gap: space[2] }}>
      <Txt size="sm" weight="medium">
        {c.measure === 'replied' ? 'Replies' : 'Interviews'}, by {c.dimension}
      </Txt>
      <View style={{ gap: space[2.5] }}>
        {c.arms.map((arm) => (
          <Row key={arm.label} arm={arm} leader={c.confident && arm.label === c.best.label} />
        ))}
      </View>
      <Txt size="xs" tone="muted">
        {c.confident
          ? `The ranges do not overlap, so this is a real difference — ${c.best.label.toLowerCase()} is worth more of your effort.`
          : 'The ranges overlap, so this is two numbers rather than a difference. More records will separate them or close the gap.'}
        {c.tooFew > 0
          ? ` ${String(c.tooFew)} other ${c.tooFew === 1 ? 'group has' : 'groups have'} fewer than ${String(MIN_ARM)} records and ${c.tooFew === 1 ? 'is' : 'are'} not compared.`
          : ''}
      </Txt>
    </View>
  )
}

export function WhatIsWorking() {
  const { all } = useApplications()
  const comparisons = useMemo(() => comparisonsFor(all), [all])

  // Silence is the right output for a young search.
  if (comparisons.length === 0) return null

  return (
    <Panel>
      <PanelTitle hint="the band is where the true rate plausibly sits">What is working</PanelTitle>
      <View style={{ gap: space[5] }}>
        {comparisons.map((c) => (
          <Group key={`${c.dimension}:${c.measure}`} c={c} />
        ))}
      </View>
    </Panel>
  )
}
