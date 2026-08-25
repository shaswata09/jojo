import { useMemo } from 'react'
import { View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { recommendationsFor } from '@jojo/service/core/recommend'
import type { Recommendation } from '@jojo/service/core/recommend'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { useApplications, useTimeline } from '@/lib/store-context'
import { TODAY } from '@/lib/today'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * What to do next, ranked, with the counts behind each line.
 *
 * The phone's half of web's `statistics/NextSteps.tsx`, and the reasoning is
 * there: the rest of the screen reports and this decides, every word of it is
 * arithmetic from `core/recommend.ts`, and the two badges exist so that a claim
 * counted from the person's own records never reads the same as one measured
 * against a benchmark this app invented.
 */

const BADGE: Record<Recommendation['strength'], string> = {
  measured: 'Measured',
  suggested: 'Suggested',
}

export function NextSteps() {
  const { all } = useApplications()
  const { all: timeline } = useTimeline()
  const graph = useGraph()
  const { projections } = useKg()

  const background = projections.background(graph).length

  const items = useMemo(
    () => recommendationsFor({ applications: all, timeline, background, today: TODAY }),
    [all, timeline, background],
  )

  const c = useColors()

  // Nothing at all means an empty search — not a search in good order, which
  // `recommendationsFor` reports as its own item.
  if (items.length === 0) return null

  return (
    <Panel>
      <PanelTitle hint="what your records support, then what costs least">
        What to do next
      </PanelTitle>

      <View style={{ gap: space[3.5] }}>
        {items.map((item) => {
          const clear = item.id === 'clear'
          return (
            <View key={item.id} style={{ flexDirection: 'row', gap: space[2.5] }}>
              <Feather
                name={clear ? 'check-circle' : item.strength === 'measured' ? 'bar-chart-2' : 'zap'}
                size={15}
                color={clear ? c.success : c.text3}
                style={{ marginTop: 2 }}
              />
              <View style={{ flex: 1, gap: space[0.5] }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}
                >
                  <Txt size="sm" weight="medium" style={{ flexShrink: 1 }}>
                    {item.headline}
                  </Txt>
                  {!clear && (
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: c.hairline,
                        borderRadius: 4,
                        paddingHorizontal: space[1.5],
                        paddingVertical: 1,
                      }}
                    >
                      <Txt size="xs" tone="muted">
                        {BADGE[item.strength]}
                      </Txt>
                    </View>
                  )}
                </View>
                <Txt size="sm" tone="secondary">
                  {item.because}
                </Txt>
              </View>
            </View>
          )
        })}
      </View>
    </Panel>
  )
}
