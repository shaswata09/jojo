import { View } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { STAGE_LABEL, displayName } from '@jojo/service/data/seed'
import { shortDate, whenLabel } from '@jojo/service/data/timeline'
import { useApplications, useTimeline, useVault } from '@/lib/store-context'
import { useOrganisations } from '@jojo/service/react/use-organisations'
import { TODAY } from '@/lib/today'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

/**
 * Everything about one employer, on a phone.
 *
 * The web page's header carries the argument; this is the same three panels
 * stacked rather than in a grid, which is the only difference a 390pt screen
 * makes to a page that is three lists.
 *
 * Reached from an application's own screen and from the `jojo://employer/<slug>`
 * link, which is what makes it worth having a route rather than a sheet: a QR
 * code on a laptop or a link out of the assistant can name an employer now.
 */
export function OrganisationScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Organisation'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { get } = useOrganisations()
  const { byId } = useApplications()
  const { forApplication: itemsFor } = useTimeline()
  const { forApplication: filedFor } = useVault()

  const organisation = get(route.params.key)

  if (!organisation) {
    return (
      <Screen title="Employer" subtitle="Nothing here answers to that address">
        <Panel>
          <EmptyState
            icon="briefcase"
            title="No employer at this address"
            description="An employer page exists for as long as an application names it. If every application to this one was deleted, so was this."
          />
        </Panel>
      </Screen>
    )
  }

  const applications = organisation.applicationIds
    .map((id) => byId.get(id))
    .filter((a) => a !== undefined)

  // De-duplicated: both relations are many-to-many, so one reminder can be about
  // two of these jobs and one referee is usually named on all of them.
  const dates = [
    ...new Map(applications.flatMap((a) => itemsFor(a.id)).map((i) => [i.id, i])).values(),
  ].sort((a, b) => a.date.localeCompare(b.date))

  const people = [
    ...new Map(applications.flatMap((a) => filedFor(a.id).people).map((p) => [p.id, p])).values(),
  ]

  const open = applications.filter((a) => a.stage !== 'closed').length

  return (
    <Screen
      title={organisation.name}
      subtitle={
        applications.length === 1
          ? 'One application here'
          : `${String(applications.length)} applications here, ${String(open)} still open`
      }
    >
      <Panel>
        <PanelTitle>Applications</PanelTitle>
        {applications.map((a, i) => (
          <View key={a.id}>
            {i > 0 ? <Divider /> : null}
            <View style={[s.row, { gap: space[2], paddingVertical: space[3] }]}>
              <View style={s.fill}>
                <Txt
                  size="sm"
                  tone="info"
                  onPress={() => navigation.navigate('ApplicationDetail', { id: a.id })}
                >
                  {a.role || displayName(a)}
                </Txt>
                {a.note ? (
                  <Txt size="xs" tone="muted">
                    {a.note}
                  </Txt>
                ) : null}
              </View>
              <Chip size="sm">{STAGE_LABEL[a.stage]}</Chip>
            </View>
          </View>
        ))}
      </Panel>

      <Panel>
        <PanelTitle
          hint={dates.length > 0 ? `${String(dates.length)} across these jobs` : undefined}
        >
          Dates
        </PanelTitle>
        {dates.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="Nothing dated here"
            description="Deadlines, interviews and reminders about any of these jobs collect on this screen."
          />
        ) : (
          dates.map((item, i) => (
            <View key={item.id}>
              {i > 0 ? <Divider /> : null}
              <View style={[s.row, { gap: space[2], paddingVertical: space[3] }]}>
                <View style={s.fill}>
                  <Txt size="sm">{item.title}</Txt>
                  {item.detail ? (
                    <Txt size="xs" tone="muted">
                      {item.detail}
                    </Txt>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt size="xs" mono tone="secondary">
                    {shortDate(item.date)}
                  </Txt>
                  <Txt size="xs" tone="muted">
                    {whenLabel(item, TODAY)}
                  </Txt>
                </View>
              </View>
            </View>
          ))
        )}
      </Panel>

      <Panel>
        <PanelTitle hint={people.length > 0 ? `${String(people.length)} named` : undefined}>
          People
        </PanelTitle>
        {people.length === 0 ? (
          <EmptyState
            icon="user"
            title="Nobody named yet"
            description="Referees, search chairs and recruiters named on any of these jobs show up here."
          />
        ) : (
          people.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ paddingVertical: space[3] }}>
                <Txt size="sm">{p.name}</Txt>
                {p.role ? (
                  <Txt size="xs" tone="muted">
                    {p.role}
                  </Txt>
                ) : null}
                {p.email ? (
                  <Txt size="xs" tone="info" mono>
                    {p.email}
                  </Txt>
                ) : null}
              </View>
            </View>
          ))
        )}
      </Panel>
    </Screen>
  )
}
