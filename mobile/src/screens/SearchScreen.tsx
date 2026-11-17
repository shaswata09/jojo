import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TODAY } from '@/lib/today'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { SearchInput } from '@/components/ui/SearchInput'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { s } from '@/theme/styles'
import { Txt } from '@/components/ui/Text'
import { STAGE_LABEL, displayName } from '@jojo/service/data/seed'
import { useCreateActions, useRunCreateAction } from '@/lib/create-actions'
import { DESTINATIONS } from '@/lib/destinations'
import { matchesQuery } from '@/lib/search'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useScout, useTimeline, useVault } from '@/lib/store-context'
import type { FeatherName } from '@/lib/timeline-visuals'
import { KIND_ICON } from '@/lib/timeline-visuals'
import type { RootStackParamList } from '@/navigation/types'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * Rows drawn per group until the person asks for the rest.
 *
 * A one-letter query matches nearly every record, and every match is a
 * Pressable row mounted inside a ScrollView — there is no virtualised list on
 * the phone — on every keystroke. Twenty is more than a phone screen shows, so
 * nothing is hidden that would have been seen without scrolling.
 */
const GROUP_ROWS = 20
import { TourTarget } from '@/components/tour/TourTarget'
import { useDomain } from '@/i18n/domain'

type Result = {
  id: string
  icon: FeatherName
  title: string
  detail: string
  /** Which section the result is listed under; a key, translated when drawn. */
  group: 'applications' | 'reminders' | 'calendar' | 'vault' | 'jobScout' | 'goTo'
  onPress: () => void
}

/**
 * One field over every collection.
 *
 * The web version is a ⌘K palette; a phone has no ⌘, so this is a screen the
 * tab bar's search button pushes. What it searches is the same: applications,
 * dated items, links, files, snippets and saved postings, all at once — because
 * "where did I put the Rice thing" is a question about the record, not about
 * which list it happens to live in.
 */
export function SearchScreen() {
  const { t, i18n } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { open } = useSheets()
  const runCreateAction = useRunCreateAction()
  const createActions = useCreateActions()

  const { all: applications } = useApplications()
  const { all: items } = useTimeline()
  const { links, files, snippets } = useVault()
  const { postings, matches } = useScout()

  const [query, setQuery] = useState('')
  const q = query.trim()
  /** Groups opened past `GROUP_ROWS`, for this query only. */
  const [expanded, setExpanded] = useState<{ query: string; groups: Set<string> }>({
    query: '',
    groups: new Set(),
  })
  const shown = (group: string) => expanded.query === q && expanded.groups.has(group)

  const results = useMemo<Result[]>(() => {
    if (!q) return []
    const hit = (...parts: (string | undefined)[]) => matchesQuery(q, ...parts)

    const out: Result[] = []

    for (const a of applications) {
      // The stage in both the English the record is written in and the words
      // on screen, so either finds it.
      const stage = domain.stage(a.stage)
      if (!hit(a.org, a.role, a.note, a.roleTag, STAGE_LABEL[a.stage], stage, a.location)) continue
      out.push({
        id: `app-${a.id}`,
        icon: 'clipboard',
        title: displayName(a),
        detail: `${stage} · ${a.roleTag}`,
        group: 'applications',
        onPress: () => navigation.navigate('ApplicationDetail', { id: a.id }),
      })
    }

    for (const i of items) {
      if (!hit(i.title, i.detail, i.note)) continue
      out.push({
        id: `item-${i.id}`,
        icon: KIND_ICON[i.kind],
        title: i.title,
        detail: `${domain.shortDate(i.date)} · ${domain.when(i, TODAY)}`,
        group: i.remind ? 'reminders' : 'calendar',
        onPress: () => open('timelineItem', { mode: i.remind ? 'reminder' : 'event', initial: i }),
      })
    }

    for (const l of links) {
      if (!hit(l.title, l.url, l.note, l.category)) continue
      out.push({
        id: `link-${l.id}`,
        icon: 'link-2',
        title: l.title,
        detail: l.category,
        group: 'vault',
        onPress: () => navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'links' } }),
      })
    }

    for (const f of files) {
      if (!hit(f.name, f.note, f.bucket)) continue
      out.push({
        id: `file-${f.id}`,
        icon: 'file-text',
        title: f.name,
        detail: `${f.bucket} · ${f.size}`,
        group: 'vault',
        onPress: () => navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'files' } }),
      })
    }

    for (const s of snippets) {
      if (!hit(s.title, s.body, s.tag)) continue
      out.push({
        id: `snippet-${s.id}`,
        icon: 'copy',
        title: s.title,
        detail: s.tag,
        group: 'vault',
        onPress: () =>
          navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'snippets' } }),
      })
    }

    for (const p of postings) {
      if (!hit(p.title, p.url)) continue
      out.push({
        id: `posting-${p.id}`,
        icon: 'external-link',
        title: p.title,
        detail: p.url,
        group: 'jobScout',
        onPress: () => navigation.navigate('JobScout'),
      })
    }

    for (const m of matches) {
      if (!hit(m.role, m.detail)) continue
      out.push({
        id: `match-${m.id}`,
        icon: 'radio',
        title: m.role,
        detail: t('search.fit', { fit: m.fit }),
        group: 'jobScout',
        onPress: () => navigation.navigate('JobScout'),
      })
    }

    // Last, and deliberately so. A screen matches on a short generic word far
    // more often than a record does — "calendar" would otherwise bury the two
    // interviews you were looking for under the page they live on.
    for (const d of DESTINATIONS) {
      if (!hit(d.label, d.hint)) continue
      out.push({
        id: d.id,
        icon: d.icon,
        title: d.label,
        detail: d.hint,
        group: 'goTo',
        onPress: () => d.go(navigation),
      })
    }

    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language is what `domain` reads; a switch must re-run this
  }, [
    q,
    applications,
    items,
    links,
    files,
    snippets,
    postings,
    matches,
    navigation,
    open,
    t,
    domain,
    i18n.language,
  ])

  const grouped = useMemo(() => {
    const map = new Map<Result['group'], Result[]>()
    // Pushed, not spread: a spread copied the group's array once per row, which
    // is quadratic in the size of the group on every keystroke.
    for (const r of results) {
      const rows = map.get(r.group)
      if (rows) rows.push(r)
      else map.set(r.group, [r])
    }
    return [...map.entries()]
  }, [results])

  return (
    <Screen title={t('search.title')} subtitle={t('search.subtitle')}>
      {/* Marked for the guided tour, which lights the field to type in. */}
      <TourTarget id="search-field">
        <SearchInput
          label={t('search.fieldLabel')}
          value={query}
          onChange={setQuery}
          placeholder={t('search.placeholder')}
          autoFocus
        />
      </TourTarget>

      {!q ? (
        <>
          <Panel>
            <EmptyState
              icon="search"
              title={t('search.idleTitle')}
              description={t('search.idleDescription')}
            />
          </Panel>

          {/* The create actions, where the web palette puts them. Search is the
              one screen you reach when you cannot find something, and half the
              time the answer is that it does not exist yet. */}
          <Panel padded={false}>
            <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
              <PanelTitle hint={t('search.createHint')}>{t('search.create')}</PanelTitle>
            </View>
            {createActions.map((action, i) => (
              <View key={action.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => runCreateAction(action)}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.rowHover }]}
                >
                  <Feather name={action.icon} size={16} color={c.text3} />
                  <View style={s.fill}>
                    <Txt size="sm">{action.label}</Txt>
                    {action.hint ? (
                      <Txt size="xs" tone="muted" numberOfLines={1}>
                        {action.hint}
                      </Txt>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={16} color={c.text3} />
                </Pressable>
              </View>
            ))}
          </Panel>
        </>
      ) : results.length === 0 ? (
        <Panel>
          <EmptyState
            icon="search"
            title={t('search.noneTitle', { query: query.trim() })}
            description={t('search.noneDescription')}
          />
        </Panel>
      ) : (
        grouped.map(([group, rows]) => (
          <Panel key={group} padded={false}>
            <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
              <PanelTitle hint={t('search.results', { count: rows.length })}>
                {t(`search.groups.${group}`)}
              </PanelTitle>
            </View>
            {(shown(group) ? rows : rows.slice(0, GROUP_ROWS)).map((r, i) => (
              <View key={r.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={r.onPress}
                  style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.rowHover }]}
                >
                  <Feather name={r.icon} size={16} color={c.text3} />
                  <View style={s.fill}>
                    <Txt size="sm" numberOfLines={1}>
                      {r.title}
                    </Txt>
                    <Txt size="xs" tone="muted" numberOfLines={1}>
                      {r.detail}
                    </Txt>
                  </View>
                  <Feather name="chevron-right" size={16} color={c.text3} />
                </Pressable>
              </View>
            ))}
            {rows.length > GROUP_ROWS && !shown(group) ? (
              <Button
                label={t('search.showAll', { count: rows.length })}
                variant="ghost"
                onPress={() =>
                  setExpanded((was) => ({
                    query: q,
                    groups: new Set([...(was.query === q ? was.groups : []), group]),
                  }))
                }
                style={{ alignSelf: 'flex-start', margin: space[2] }}
              />
            ) : null}
          </Panel>
        ))
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: space[4],
  },
})
