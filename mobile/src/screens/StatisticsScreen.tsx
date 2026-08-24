import { useMemo, useState } from 'react'
import { TODAY } from '@/lib/today'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  ChartLegend,
  Donut,
  Meter,
  Radar,
  StackedBars,
  StackedStrip,
} from '@/components/charts/Charts'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Columns, Screen } from '@/components/ui/Screen'
import { Segment } from '@/components/ui/Segment'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { PERIODS } from '@jojo/service/data/seed'
import type { Period, RoleTag } from '@jojo/service/data/seed'
import { bucketKey, bucketKeys, bucketLabel, sentOn } from '@jojo/service/core/frequency'
import { searchHealthFor, statsFor } from '@jojo/service/core/statistics'
import { useRoles } from '@/lib/roles-context'
import { useRoleVocabulary } from '@jojo/service/react/use-roles'
import { useSeriesToggle } from '@/lib/use-series-toggle'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useTimeline } from '@/lib/store-context'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * Below three plotted axes a radar is a line or a triangle with nothing to
 * compare, so the panel says what is missing instead of drawing a shape.
 */
const MIN_AXES = 3

export function StatisticsScreen() {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { all, sourceCounts } = useApplications()
  const { all: timeline } = useTimeline()
  const { open } = useSheets()
  const { matches: roleMatches } = useRoles()
  const vocabulary = useRoleVocabulary()
  // "The roles currently showing" — the store's vocabulary, filtered by the
  // global role filter. It used to be a field on the provider, back when the
  // vocabulary was a constant the provider could read.
  const activeRoles = vocabulary.filter(roleMatches)

  const [showTypical, setShowTypical] = useState(true)
  const [period, setPeriod] = useState<Period>('month')

  const { sent, kpis, funnel, outcomes, roles } = useMemo(() => statsFor(all), [all])

  /**
   * Outcomes are slices of one whole, so a sequential ramp. They used to be
   * teal / red / grey / green, which spent the app's past-due red on "Rejected"
   * and its success green on a band one record wide — neither is a status here,
   * and both were scoring a person.
   *
   * "No reply" takes the neutral rather than a fifth ramp step: nothing happened
   * to those records, and the ramp only has four rungs to spend.
   */
  const OUTCOME_RAMP = [...c.ramp, c.text3]

  const outcomeToggle = useSeriesToggle(outcomes.map((o) => o.label))
  const visibleOutcomes = outcomes.filter((o) => !outcomeToggle.isHidden(o.label))
  const outcomeTotal = visibleOutcomes.reduce((n, o) => n + o.count, 0)
  const share = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

  const health = useMemo(
    () =>
      searchHealthFor({ applications: all, timeline, today: TODAY }).filter(
        (a) => a.score !== null,
      ),
    [all, timeline],
  )
  const ranked = [...health].sort((a, b) => (a.score ?? 0) - a.target - ((b.score ?? 0) - b.target))
  const radarToggle = useSeriesToggle(['you', 'target'])

  /**
   * The bars, counted from the records.
   *
   * This read `frequencyByPeriod[period]` — a frozen table of hand-authored
   * counts in the fixtures — so the panel was literally incapable of being
   * empty and kept narrating a search after the store had been cleared. Web
   * fixed the same defect in `ApplicationFrequency.tsx` two waves ago and the
   * bucketing it wrote is `@jojo/service/core/frequency` now, so this is the
   * same arithmetic rather than a second answer to it.
   *
   * The axis is built from the CALENDAR, not from the records, so a week nobody
   * applied in draws a gap instead of closing up into a straight line.
   */
  const buckets = useMemo(() => {
    const dated = all.filter((a) => sentOn(a) !== undefined)
    const dates = dated.map((a) => sentOn(a) as string)
    // Always includes today, so an empty store still draws a frame and a record
    // dated ahead of today still has a bucket to land in.
    const from = dates.reduce((min, d) => (d < min ? d : min), TODAY)
    const to = dates.reduce((max, d) => (d > max ? d : max), TODAY)

    const blank = () => Object.fromEntries(vocabulary.map((r) => [r, 0])) as Record<RoleTag, number>
    const keys = bucketKeys(from, to, period)
    const counts = new Map(keys.map((k) => [k, blank()]))
    for (const a of dated) {
      const row = counts.get(bucketKey(sentOn(a) as string, period))
      if (row) row[a.roleTag] += 1
    }
    return keys.map((key) => ({
      label: bucketLabel(key, period),
      counts: counts.get(key) ?? blank(),
    }))
  }, [all, period, vocabulary])

  // Nothing on this screen survives a zero: a rate has no denominator, a funnel
  // has no first step, and every panel would be an invented search sitting
  // beside a store the user has just emptied.
  if (all.length === 0) {
    return (
      <Screen
        title="Statistics"
        subtitle="Nothing to measure yet — this screen fills in as you add applications."
      >
        <Panel>
          <EmptyState
            icon="bar-chart-2"
            title="No applications to measure"
            description="Response rates, a funnel and a week-by-week chart all need records to count. Add the first one and this starts filling in."
            action={
              <Button label="New application" icon="plus" onPress={() => open('application')} />
            }
          />
        </Panel>
      </Screen>
    )
  }

  // Indexed by the store's vocabulary, so a role keeps its colour as long as
  // the list keeps its order — and a role only on a record still gets one.
  const roleColor = (role: RoleTag) => c.series[vocabulary.indexOf(role) % c.series.length]

  return (
    <Screen
      title="Statistics"
      subtitle={
        sent > 0
          ? 'Counted from your own records. Figures labelled typical are a sample search, there to compare against.'
          : 'Counted from your own records. It fills in as applications go out.'
      }
      options={
        sent > 0 ? (
          <SettingRow
            label="Compare with a typical search"
            description="A sample figure beside each headline number"
            control={
              <Toggle
                value={showTypical}
                onValueChange={setShowTypical}
                label="Compare with a typical search"
              />
            }
          />
        ) : undefined
      }
    >
      {/* Charts and tables, each self-contained and read in any order —
          which is what makes them safe to place side by side on a tablet. */}
      <Columns>
        {/* Headline rates, rendered only once something has actually been sent: a
            rate over an empty denominator is a made-up number. */}
        {sent > 0 ? (
          <View style={styles.kpiGrid}>
            {kpis.map((k) => (
              <Panel key={k.label} style={styles.kpi}>
                <Txt size="xs" tone="secondary">
                  {k.label}
                </Txt>
                <View style={styles.kpiValue}>
                  <Txt size="xxl" weight="semibold">
                    {k.value}
                  </Txt>
                  {/* No arrow and no colour. This slot used to hold "+6 points"
                      under an up arrow — a claim about change over time that the
                      store has no history to support. */}
                  {showTypical ? (
                    <Txt size="xs" tone="muted">
                      {k.typical}
                    </Txt>
                  ) : null}
                </View>
                <Txt size="xs" tone="muted">
                  {k.note}
                </Txt>
              </Panel>
            ))}
          </View>
        ) : null}

        <Panel>
          <PanelTitle hint="by the role each was for">Applications over time</PanelTitle>
          <Segment
            label="Period"
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            style={{ marginBottom: space[4] }}
          />
          <StackedBars
            bars={buckets.map((b) => ({
              label: b.label,
              parts: activeRoles.map((role) => ({
                key: role,
                value: b.counts[role],
                color: roleColor(role),
              })),
            }))}
          />
          <View style={{ marginTop: space[3] }}>
            <ChartLegend
              items={activeRoles.map((role) => ({
                key: role,
                label: role,
                color: roleColor(role),
              }))}
              isHidden={() => false}
              onToggle={() => {}}
            />
          </View>
          <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
            Each period is its own window, so totals differ between them — a quarter covers earlier
            searches, a week only this season.
          </Txt>
        </Panel>

        <Panel>
          <PanelTitle hint={`${all.length} tracked`}>Where they came from</PanelTitle>
          <View style={styles.donutRow}>
            <Donut
              slices={sourceCounts.map((source, i) => ({
                label: source.source,
                value: source.count,
                color: c.ramp[i % c.ramp.length],
              }))}
              centerValue={String(all.length)}
              centerLabel="tracked"
            />
            <View style={s.fill}>
              {sourceCounts.map((source, i) => (
                <View key={source.source} style={styles.legendRow}>
                  <View
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: c.ramp[i % c.ramp.length],
                        borderColor: c.ramp[i % c.ramp.length],
                      },
                    ]}
                  />
                  <Txt size="sm" tone="secondary" style={s.fill} numberOfLines={1}>
                    {source.source}
                  </Txt>
                  <Txt size="sm" mono>
                    {source.count}
                  </Txt>
                  <Txt size="xs" tone="muted" mono>
                    {share(source.count, all.length)}%
                  </Txt>
                </View>
              ))}
            </View>
          </View>
        </Panel>

        <Panel>
          {/* The hint is load-bearing, not decoration. Only the current stage is
              stored, so a record rejected after an interview counts as far as the
              dates it carries and no further. */}
          <PanelTitle hint={sent > 0 ? 'as far as each record shows' : undefined}>
            How far applications got
          </PanelTitle>

          {sent === 0 ? (
            <EmptyState
              icon="send"
              title="Nothing has been sent yet"
              description="Reply, interview and offer rates all count applications that have actually gone out. Move one out of Draft and this fills in."
              action={
                <Button
                  label="Open applications"
                  variant="outline"
                  onPress={() => navigation.navigate('Tabs', { screen: 'Applications' })}
                />
              }
            />
          ) : (
            <View style={{ gap: space[3.5] }}>
              {funnel.map((step, i) => {
                const pct = (step.count / sent) * 100
                const prev = i === 0 ? null : funnel[i - 1]
                return (
                  <View key={step.stage}>
                    <View style={styles.funnelHead}>
                      <Txt size="sm" tone="secondary" style={s.fill}>
                        {step.stage}
                      </Txt>
                      <Txt size="sm" mono>
                        {step.count}
                      </Txt>
                      <Txt size="xs" tone="muted" mono>
                        {Math.round(pct)}%
                      </Txt>
                    </View>
                    {/* One hue: length already encodes magnitude and the
                        percentage carries the meaning. */}
                    <Meter value={step.count} max={sent} color={c.info} />
                    {prev ? (
                      <Txt size="xs" tone="muted" style={{ marginTop: space[1] }}>
                        {share(step.count, prev.count)}% carried through
                      </Txt>
                    ) : null}
                  </View>
                )
              })}
            </View>
          )}
        </Panel>

        <Panel>
          {/* Every record lands in exactly one band, drafts included, so this
              total is the same total the board shows. */}
          <PanelTitle
            hint={
              outcomeTotal === all.length
                ? `${all.length} ${all.length === 1 ? 'application' : 'applications'}`
                : `${outcomeTotal} of ${all.length}`
            }
          >
            Outcomes
          </PanelTitle>

          <StackedStrip
            slices={visibleOutcomes.map((o) => ({
              label: o.label,
              value: o.count,
              color: OUTCOME_RAMP[outcomes.indexOf(o) % OUTCOME_RAMP.length],
            }))}
          />

          {/* Every band can be switched off, and then the bar says nothing at
              all — so the state is named and the reset is one press. */}
          {outcomeToggle.allHidden ? (
            <View style={styles.allHidden}>
              <Txt size="xs" tone="muted">
                Every outcome is switched off.
              </Txt>
              <Button label="Show all" variant="outline" onPress={outcomeToggle.showAll} />
            </View>
          ) : null}

          <View style={{ marginTop: space[3] }}>
            {outcomes.map((o, i) => {
              const off = outcomeToggle.isHidden(o.label)
              const color = OUTCOME_RAMP[i % OUTCOME_RAMP.length]
              return (
                <Pressable
                  key={o.label}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !off }}
                  onPress={() => outcomeToggle.toggle(o.label)}
                  style={styles.legendRow}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: off ? 'transparent' : color, borderColor: color },
                    ]}
                  />
                  <Txt
                    size="sm"
                    tone={off ? 'muted' : 'secondary'}
                    style={[s.fill, off && s.struck]}
                    numberOfLines={1}
                  >
                    {o.label}
                  </Txt>
                  <Txt size="sm" mono tone={off ? 'muted' : 'primary'}>
                    {o.count}
                  </Txt>
                  <Txt size="xs" tone="muted" mono>
                    {off ? 0 : share(o.count, outcomeTotal)}%
                  </Txt>
                </Pressable>
              )
            })}
          </View>
        </Panel>

        <Panel>
          <PanelTitle
            hint={health.length >= MIN_AXES ? 'your figures against a typical search' : undefined}
            right={
              health.length >= MIN_AXES ? (
                <Chip size="sm" tone="gray">
                  Sample
                </Chip>
              ) : undefined
            }
          >
            What to work on next
          </PanelTitle>

          {health.length < MIN_AXES ? (
            <EmptyState
              icon="compass"
              title="Not enough to compare yet"
              description="This weighs your replies, interviews, referrals and follow-ups against a typical search. It needs applications that have actually gone out."
              action={
                <Button
                  label="Open applications"
                  variant="outline"
                  onPress={() => navigation.navigate('Tabs', { screen: 'Applications' })}
                />
              }
            />
          ) : (
            <>
              {radarToggle.allHidden ? (
                <View style={styles.allHidden}>
                  <Txt size="xs" tone="muted">
                    Both series are switched off.
                  </Txt>
                  <Button label="Show all" variant="outline" onPress={radarToggle.showAll} />
                </View>
              ) : (
                <Radar
                  axes={health.map((a) => a.axis)}
                  series={[
                    { key: 'you', label: 'Yours', color: c.series[0] },
                    { key: 'target', label: 'Typical', color: c.text3 },
                  ]
                    .filter((s) => !radarToggle.isHidden(s.key))
                    .map((s) => ({
                      label: s.label,
                      color: s.color,
                      values: health.map((a) => (s.key === 'you' ? (a.score ?? 0) : a.target)),
                    }))}
                />
              )}

              <View style={{ alignItems: 'center', marginTop: space[2] }}>
                <ChartLegend
                  items={[
                    { key: 'you', label: 'Yours', color: c.series[0] },
                    { key: 'target', label: 'Typical', color: c.text3 },
                  ]}
                  isHidden={radarToggle.isHidden}
                  onToggle={radarToggle.toggle}
                />
              </View>

              <Txt
                size="xs"
                tone="muted"
                uppercase
                style={{ marginTop: space[4], marginBottom: space[2] }}
              >
                Suggestions, most useful first
              </Txt>
              {ranked.map((a, i) => (
                <View key={a.axis}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.suggestion}>
                    <Txt size="xs" tone="muted" mono style={{ marginTop: 2 }}>
                      {i + 1}
                    </Txt>
                    <View style={s.fill}>
                      <Txt size="sm">
                        {a.axis}{' '}
                        <Txt size="xs" tone="muted">
                          {a.basis}
                        </Txt>
                      </Txt>
                      <Txt size="xs" tone="muted" style={{ marginTop: 2 }}>
                        {a.suggestion}
                      </Txt>
                    </View>
                  </View>
                </View>
              ))}
            </>
          )}
        </Panel>

        {/* Only roles something has actually been sent for. A row of zeros under a
            role the user has never applied for is data the screen invented. */}
        {roles.length > 0 ? (
          <Panel>
            <PanelTitle hint="as far as each record shows">
              How each kind of role is going
            </PanelTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={styles.tableHead}>
                  <Txt size="xs" tone="muted" style={styles.colRole}>
                    Roles
                  </Txt>
                  <Txt size="xs" tone="muted" style={styles.colNum}>
                    Applied
                  </Txt>
                  <Txt size="xs" tone="muted" style={styles.colNum}>
                    Replied
                  </Txt>
                  <Txt size="xs" tone="muted" style={styles.colNum}>
                    Interviews
                  </Txt>
                  <Txt size="xs" tone="muted" style={styles.colNum}>
                    Offers
                  </Txt>
                </View>
                {roles.map((r, i) => (
                  <View key={r.role}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.tableRow}>
                      {/* Plain text, not a chip: a role is a category, and a
                          coloured pill on one would claim a status it has not got. */}
                      <Txt size="sm" tone="secondary" style={styles.colRole} numberOfLines={1}>
                        {r.role}
                      </Txt>
                      <Txt size="sm" mono style={styles.colNum}>
                        {r.applied}
                      </Txt>
                      <Txt size="sm" mono style={styles.colNum}>
                        {r.responded}
                      </Txt>
                      <Txt size="sm" mono style={styles.colNum}>
                        {r.interviews}
                      </Txt>
                      <Txt size="sm" mono style={styles.colNum}>
                        {r.offers}
                      </Txt>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
          </Panel>
        ) : null}
      </Columns>
    </Screen>
  )
}

const styles = StyleSheet.create({
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  kpi: { width: '47%', flexGrow: 1, gap: 2 },
  kpiValue: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 36 },
  swatch: { width: 11, height: 11, borderRadius: 3, borderWidth: 1.5 },
  funnelHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space[2],
    marginBottom: space[1.5],
  },
  allHidden: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] },
  suggestion: { flexDirection: 'row', gap: space[3], paddingVertical: space[2.5] },
  tableHead: { flexDirection: 'row', paddingBottom: space[2] },
  tableRow: { flexDirection: 'row', paddingVertical: space[2.5] },
  colRole: { width: 150 },
  colNum: { width: 80, textAlign: 'right' },
})
