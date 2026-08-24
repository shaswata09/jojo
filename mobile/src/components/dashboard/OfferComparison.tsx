import { View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Chip } from '@/components/ui/Chip'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { annualised, comparable, parseComp } from '@jojo/service/core/comp'
import type { ParsedComp } from '@jojo/service/core/comp'
import { offerDaysLeft, shortDate } from '@jojo/service/core/dates'
import { displayName } from '@jojo/service/data/seed'
import { useApplications } from '@/lib/store-context'
import { TODAY } from '@/lib/today'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

/**
 * Two offers, compared, on the screen a phone opens on.
 *
 * The web app's panel carries the argument for the feature; what differs here is
 * the shape. A four-column table does not fit 390pt, and squeezing one in is how
 * a comparison becomes something you scroll sideways and therefore never read.
 * These are rows, biggest package first, with the figure and the clock on the
 * right — which is the ordering a person actually wants at this moment.
 *
 * Sorted only when the figures can honestly be ranked. Mixed currencies keep
 * their original order and say so, because there is no exchange rate in this app
 * and inventing one would be worse than declining to sort.
 */
export function OfferComparison() {
  const { offers } = useApplications()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  if (offers.length < 2) return null

  const rows = offers.map((a) => ({
    application: a,
    parsed: a.offer.comp ? parseComp(a.offer.comp) : undefined,
    daysLeft: offerDaysLeft(a.offer, TODAY),
  }))

  const parsed = rows.map((r) => r.parsed).filter((p): p is ParsedComp => p !== undefined)
  const rankable = parsed.length > 1 && parsed.every((p) => comparable(p, parsed[0] as ParsedComp))
  const ordered = rankable
    ? [...rows].sort(
        (a, b) => (b.parsed ? annualised(b.parsed) : -1) - (a.parsed ? annualised(a.parsed) : -1),
      )
    : rows

  return (
    <Panel>
      <PanelTitle hint={`${offers.length} open`}>Offers, side by side</PanelTitle>

      {ordered.map(({ application, parsed: p, daysLeft }, i) => (
        <View key={application.id}>
          {i > 0 ? <Divider /> : null}
          <View
            style={[s.row, { alignItems: 'flex-start', gap: space[3], paddingVertical: space[3] }]}
          >
            <View style={s.fill}>
              <Txt
                size="sm"
                tone="info"
                onPress={() => navigation.navigate('ApplicationDetail', { id: application.id })}
              >
                {displayName(application)}
              </Txt>
              {/* The user's own words. The figure on the right is a reading of
                  this, never a replacement for it. */}
              <Txt size="xs" tone="muted">
                {application.offer.comp || 'Package not stated'}
              </Txt>
              <Txt size="xs" tone="muted">
                Respond by {shortDate(application.offer.respondBy)}
              </Txt>
            </View>

            <View style={{ alignItems: 'flex-end', gap: space[1] }}>
              <Txt size="sm" mono>
                {p ? `${annualised(p).toLocaleString()}${p.period === 'year' ? '' : '*'}` : '—'}
              </Txt>
              <Chip tone={daysLeft <= 3 ? 'red' : daysLeft <= 7 ? 'amber' : 'gray'} size="sm">
                {daysLeft < 0
                  ? 'passed'
                  : daysLeft === 0
                    ? 'today'
                    : `${String(daysLeft)} day${daysLeft === 1 ? '' : 's'}`}
              </Chip>
            </View>
          </View>
        </View>
      ))}

      <Txt size="xs" tone="muted" style={{ marginTop: space[1] }}>
        {rankable
          ? 'Yearly figures, read from what you typed.'
          : 'Not ranked — the packages are in different currencies, and jojo has no exchange rate.'}
        {parsed.some((p) => p.period !== 'year')
          ? ' * annualised at 12 months, 52 weeks or 2,080 hours.'
          : ''}
      </Txt>
    </Panel>
  )
}
