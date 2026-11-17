import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@jojo/service/data/seed'
import { useApplications, useTimeline, useVault } from '@/lib/store-context'
import { useOrganisations } from '@jojo/service/react/use-organisations'
import { TODAY } from '@/lib/today'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'

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
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const route = useRoute<RouteProp<RootStackParamList, 'Organisation'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { get } = useOrganisations()
  const { byId } = useApplications()
  const { forApplication: itemsFor } = useTimeline()
  const { forApplication: filedFor } = useVault()

  const organisation = get(route.params.key)

  if (!organisation) {
    return (
      <Screen title={t('organisation.missing.title')} subtitle={t('organisation.missing.subtitle')}>
        <Panel>
          <EmptyState
            icon="briefcase"
            title={t('organisation.missing.emptyTitle')}
            description={t('organisation.missing.emptyDescription')}
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
          ? t('organisation.subtitleOne')
          : t('organisation.subtitleMany', { count: applications.length, open })
      }
    >
      <Panel>
        <PanelTitle>{t('organisation.applications')}</PanelTitle>
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
              <Chip size="sm">{domain.stage(a.stage)}</Chip>
            </View>
          </View>
        ))}
      </Panel>

      <Panel>
        <PanelTitle
          hint={dates.length > 0 ? t('organisation.datesHint', { count: dates.length }) : undefined}
        >
          {t('organisation.dates')}
        </PanelTitle>
        {dates.length === 0 ? (
          <EmptyState
            icon="calendar"
            title={t('organisation.datesEmptyTitle')}
            description={t('organisation.datesEmptyDescription')}
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
                    {domain.shortDate(item.date)}
                  </Txt>
                  <Txt size="xs" tone="muted">
                    {domain.when(item, TODAY)}
                  </Txt>
                </View>
              </View>
            </View>
          ))
        )}
      </Panel>

      <Panel>
        <PanelTitle
          hint={
            people.length > 0 ? t('organisation.peopleHint', { count: people.length }) : undefined
          }
        >
          {t('organisation.people')}
        </PanelTitle>
        {people.length === 0 ? (
          <EmptyState
            icon="user"
            title={t('organisation.peopleEmptyTitle')}
            description={t('organisation.peopleEmptyDescription')}
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
