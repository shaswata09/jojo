import { useMemo, useState } from 'react'
import { TODAY } from '@/lib/today'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { SearchInput } from '@/components/ui/SearchInput'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { s } from '@/theme/styles'
import { Txt } from '@/components/ui/Text'
import { STAGE_LABEL, displayName } from '@jojo/service/data/seed'
import { shortDate, whenLabel } from '@jojo/service/data/timeline'
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

type Result = {
  id: string
  icon: FeatherName
  title: string
  detail: string
  group: string
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

  const results = useMemo<Result[]>(() => {
    if (!q) return []
    const hit = (...parts: (string | undefined)[]) => matchesQuery(q, ...parts)

    const out: Result[] = []

    for (const a of applications) {
      if (!hit(a.org, a.role, a.note, a.roleTag, STAGE_LABEL[a.stage], a.location)) continue
      out.push({
        id: `app-${a.id}`,
        icon: 'clipboard',
        title: displayName(a),
        detail: `${STAGE_LABEL[a.stage]} · ${a.roleTag}`,
        group: 'Applications',
        onPress: () => navigation.navigate('ApplicationDetail', { id: a.id }),
      })
    }

    for (const i of items) {
      if (!hit(i.title, i.detail, i.note)) continue
      out.push({
        id: `item-${i.id}`,
        icon: KIND_ICON[i.kind],
        title: i.title,
        detail: `${shortDate(i.date)} · ${whenLabel(i, TODAY)}`,
        group: i.remind ? 'Reminders' : 'Calendar',
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
        group: 'Vault',
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
        group: 'Vault',
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
        group: 'Vault',
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
        group: 'Job scout',
        onPress: () => navigation.navigate('JobScout'),
      })
    }

    for (const m of matches) {
      if (!hit(m.role, m.detail)) continue
      out.push({
        id: `match-${m.id}`,
        icon: 'radio',
        title: m.role,
        detail: `${m.fit}% fit`,
        group: 'Job scout',
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
        group: 'Go to',
        onPress: () => d.go(navigation),
      })
    }

    return out
  }, [q, applications, items, links, files, snippets, postings, matches, navigation, open])

  const grouped = useMemo(() => {
    const map = new Map<string, Result[]>()
    for (const r of results) map.set(r.group, [...(map.get(r.group) ?? []), r])
    return [...map.entries()]
  }, [results])

  return (
    <Screen title="Search" subtitle="Applications, dates, the vault and the scout, all at once">
      <SearchInput
        label="Search everything"
        value={query}
        onChange={setQuery}
        placeholder="Search applications, reminders, files…"
        autoFocus
      />

      {!q ? (
        <>
          <Panel>
            <EmptyState
              icon="search"
              title="Type to search"
              description="One field over every collection — because “where did I put the Rice thing” is a question about the record, not about which list it lives in."
            />
          </Panel>

          {/* The create actions, where the web palette puts them. Search is the
              one screen you reach when you cannot find something, and half the
              time the answer is that it does not exist yet. */}
          <Panel padded={false}>
            <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
              <PanelTitle hint="nothing to find? make it">Create</PanelTitle>
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
            title={`Nothing matches “${query.trim()}”`}
            description="Search reads the title, note and category of every record. Nothing here is fetched from anywhere else."
          />
        </Panel>
      ) : (
        grouped.map(([group, rows]) => (
          <Panel key={group} padded={false}>
            <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
              <PanelTitle hint={`${rows.length} ${rows.length === 1 ? 'result' : 'results'}`}>
                {group}
              </PanelTitle>
            </View>
            {rows.map((r, i) => (
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
