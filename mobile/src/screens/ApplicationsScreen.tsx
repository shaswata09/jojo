import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { LabelChips, LabelFilter } from '@/components/common/Labels'
import { StagePicker } from '@/components/common/StagePicker'
import { Button, IconButton } from '@/components/ui/Button'
import { BucketFilter } from '@/components/ui/BucketFilter'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { MenuSheet } from '@/components/ui/Menu'
import { Screen } from '@/components/ui/Screen'
import { SearchInput } from '@/components/ui/SearchInput'
import { Segment } from '@/components/ui/Segment'
import { Divider, Panel } from '@/components/ui/Surface'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Txt } from '@/components/ui/Text'
import { ROLES, STAGES, STAGE_LABEL, displayName } from '@/data/seed'
import type { Application, RoleTag, Stage } from '@/data/seed'
import { addDays, agoLabel, compareItems, daysBetween, shortDate } from '@/data/timeline'
import type { TimelineItem } from '@/data/timeline'
import { TODAY } from '@/lib/today'
import { draftFromUrl } from '@/lib/draft-from'
import { refKey } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import { useRoles } from '@/lib/roles-context'
import { useSheets } from '@/lib/sheets-context'
import { matchesQuery } from '@/lib/search'
import { useApplications, useTimeline } from '@/lib/store-context'
import type { RootStackParamList, TabParamList } from '@/navigation/types'
import { Board } from '@/screens/applications/Board'
import { useRowActions } from '@/screens/applications/use-row-actions'
import type { RowActions } from '@/screens/applications/use-row-actions'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

type View_ = 'list' | 'board'
type SortKey = 'role' | 'stage' | 'daysAgo'
type SortDir = 'asc' | 'desc'

const VIEWS = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
] as const

/**
 * The three orderings, each with what its two directions actually mean.
 *
 * "Ascending" is meaningless to a reader deciding how to sort a list — what
 * they want to know is whether the newest or the oldest ends up on top. The
 * web version says this with an arrow on a column header; without a header row
 * to hang one on, the menu has to say it in words.
 */
const SORTS: { value: SortKey; label: string; asc: string; desc: string }[] = [
  { value: 'daysAgo', label: 'Last activity', asc: 'Most recent first', desc: 'Oldest first' },
  { value: 'stage', label: 'Stage', asc: 'Draft to closed', desc: 'Closed to draft' },
  { value: 'role', label: 'Position', asc: 'A to Z', desc: 'Z to A' },
]

/**
 * The words come from `agoLabel`, so this column speaks the same past tense as
 * "Completed 3 days ago" in the Vault — including its two-week cut-off, past
 * which a count of days stops being information and the plain date is what you
 * would say out loud.
 */
function activityLabel(daysAgo: number) {
  const ago = agoLabel(addDays(TODAY, -daysAgo), TODAY)
  return ago.charAt(0).toUpperCase() + ago.slice(1)
}

/**
 * The next thing this application owes, if anything does.
 *
 * Overdue first, then soonest: an application whose deadline passed on Friday
 * has nothing more urgent than that, so the row has to lead with it rather than
 * skip ahead to next month's interview.
 */
function nextDateOf(items: TimelineItem[] | undefined) {
  if (!items || items.length === 0) return undefined
  return [...items].filter((i) => !i.completedOn).sort(compareItems)[0]
}

export function ApplicationsScreen() {
  const route = useRoute<RouteProp<TabParamList, 'Applications'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const { all } = useApplications()
  const { all: timelineItems } = useTimeline()
  const { matches: roleMatches, selected: selectedRoles, clear: clearRoles } = useRoles()
  const { matches: keywordMatches, selected: selectedKeywords, clearSelected } = useLabels()
  const { open } = useSheets()

  const [view, setView] = useState<View_>('list')
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>(route.params?.stage ?? 'all')
  const [sort, setSort] = useState<SortKey>(route.params?.sort ?? 'daysAgo')
  const [dir, setDir] = useState<SortDir>('asc')
  const [sortOpen, setSortOpen] = useState(false)
  const [rolesOpen, setRolesOpen] = useState(false)
  const [showNotes, setShowNotes] = useState(true)
  // Lives here rather than in `Board` because the scroller it has to freeze is
  // the one `Screen` owns, two levels up from where the gesture happens.
  const [boardDragging, setBoardDragging] = useState(false)

  const actions = useRowActions()

  /**
   * The next dated thing per application, built once rather than filtered per
   * row — twelve rows each scanning the whole timeline is the shape that gets
   * slow the moment a real store is behind it.
   */
  const nextDates = useMemo(() => {
    const byApp = new Map<string, TimelineItem[]>()
    for (const item of timelineItems) {
      if (!item.applicationId) continue
      const list = byApp.get(item.applicationId)
      if (list) list.push(item)
      else byApp.set(item.applicationId, [item])
    }
    return new Map([...byApp].map(([id, items]) => [id, nextDateOf(items)]))
  }, [timelineItems])

  /**
   * Everything the screen filters by *except* the stage — the pool both views
   * draw from. The board used to read straight from `all`, so a search that
   * emptied the list left the board showing every record.
   */
  const pool = useMemo(() => {
    return all.filter((a) => {
      if (!roleMatches(a.roleTag)) return false
      if (!keywordMatches(refKey('app', a.id))) return false
      // Searches what is on screen plus the stage name, so typing "offer" finds
      // the row whose only mention of it is a chip. Accent-folded, so a search
      // for "Muñoz" typed without the tilde still finds it.
      return matchesQuery(query, a.org, a.role, a.note, a.roleTag, STAGE_LABEL[a.stage], a.location)
    })
  }, [all, query, roleMatches, keywordMatches])

  /**
   * Stage counts over the pool, not over everything. They used to be counted
   * before the search ran, so `All 8` sat above four rows.
   */
  const stageCounts = useMemo(() => {
    const map: Partial<Record<Stage, number>> = {}
    for (const a of pool) map[a.stage] = (map[a.stage] ?? 0) + 1
    return map
  }, [pool])

  const rows = useMemo(() => {
    const filtered = stageFilter === 'all' ? pool : pool.filter((a) => a.stage === stageFilter)
    return [...filtered].sort((a, b) => {
      if (sort === 'daysAgo') return a.daysAgo - b.daysAgo
      if (sort === 'stage') {
        return STAGES.findIndex((s) => s.id === a.stage) - STAGES.findIndex((s) => s.id === b.stage)
      }
      return displayName(a).localeCompare(displayName(b))
    })
  }, [pool, stageFilter, sort])

  const shown = view === 'list' ? rows.length : pool.length
  const empty = all.length === 0
  const anyFilter =
    query.trim() !== '' ||
    stageFilter !== 'all' ||
    selectedKeywords.size > 0 ||
    selectedRoles.size > 0

  /**
   * Which filters are holding the list empty, named out loud.
   *
   * Four controls can blank it, and "nothing matches" without saying which one
   * is doing it leaves the reader hunting across the toolbar for the switch.
   */
  const emptyReason = useMemo(() => {
    const on = [
      query.trim() ? 'that search' : '',
      stageFilter === 'all' ? '' : `the ${STAGE_LABEL[stageFilter]} stage`,
      selectedKeywords.size > 0 ? 'the selected keywords' : '',
      selectedRoles.size > 0 ? 'the selected roles' : '',
    ].filter(Boolean)
    if (on.length === 0) return 'Nothing here to show.'
    const joined = on.length === 1 ? on[0] : `${on.slice(0, -1).join(', ')} and ${on.at(-1)}`
    return `Nothing carries ${joined}.`
  }, [query, stageFilter, selectedKeywords, selectedRoles])

  const activeSort = SORTS.find((option) => option.value === sort) ?? SORTS[0]

  const clearFilters = () => {
    setQuery('')
    setStageFilter('all')
    clearSelected()
    clearRoles()
  }

  return (
    <Screen
      // Frozen while a board card is in the air. Without this the page can
      // scroll out from under the drag, and the floating card — positioned
      // against the board's measured origin — parts company with the finger.
      scrollEnabled={!boardDragging}
      title="Applications"
      subtitle={
        empty
          ? 'Nothing tracked yet — everything you add stays on this device.'
          : `${shown} shown · ${all.length} total`
      }
      actions={<Button label="New" icon="plus" onPress={() => open('application')} />}
      options={
        <SettingRow
          label="Show notes"
          description="The second line under each position"
          control={<Toggle value={showNotes} onValueChange={setShowNotes} label="Show notes" />}
        />
      }
    >
      {empty ? (
        <Panel>
          <EmptyState
            icon="clipboard"
            title="No applications yet"
            description="Track a job you are applying for and it shows up here, on the calendar and in the week ahead."
            action={
              <Button label="New application" icon="plus" onPress={() => open('application')} />
            }
          />
        </Panel>
      ) : (
        <>
          <PasteUrlRow />

          <SearchInput
            label="Search applications"
            value={query}
            onChange={setQuery}
            placeholder="Search position, note or stage"
          />

          <View style={s.row}>
            <Segment
              label="Layout"
              options={VIEWS}
              value={view}
              onChange={setView}
              style={s.fill}
            />
            <IconButton
              icon="filter"
              label="Filter by role"
              active={selectedRoles.size > 0}
              onPress={() => setRolesOpen(true)}
            />
            {view === 'list' ? (
              <IconButton
                icon={dir === 'asc' ? 'arrow-down' : 'arrow-up'}
                label={`Sort: ${activeSort.label}, ${dir === 'asc' ? activeSort.asc : activeSort.desc}`}
                onPress={() => setSortOpen(true)}
              />
            ) : null}
          </View>

          {/* Scoped to the pool on screen. Without it a chip here would count
              every reminder and vault file carrying that keyword too. */}
          <LabelFilter scopeIds={pool.map((a) => refKey('app', a.id))} />

          {/* Stage chips are list-only: the board is already grouped by stage,
              so filtering there blanks five columns rather than shortening a
              list. */}
          {view === 'list' ? (
            <BucketFilter
              label="Filter by stage"
              options={STAGES.map((s) => s.id)}
              labels={
                Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<Stage, string>
              }
              counts={stageCounts}
              value={stageFilter}
              onChange={setStageFilter}
              total={pool.length}
            />
          ) : null}

          {shown === 0 ? (
            <Panel>
              <EmptyState
                icon="clipboard"
                title="No applications match"
                description={emptyReason}
                action={
                  <>
                    {anyFilter ? (
                      <Button
                        label={`Show all ${all.length}`}
                        icon="x"
                        variant="outline"
                        onPress={clearFilters}
                      />
                    ) : null}
                    <Button
                      label="New application"
                      icon="plus"
                      onPress={() =>
                        open('application', {
                          initial: stageFilter === 'all' ? undefined : { stage: stageFilter },
                        })
                      }
                    />
                  </>
                }
              />
            </Panel>
          ) : view === 'list' ? (
            <Panel padded={false}>
              {rows.map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <Divider /> : null}
                  <ApplicationRow
                    application={a}
                    nextDate={nextDates.get(a.id)}
                    showNote={showNotes}
                    actions={actions}
                    onOpen={() => navigation.navigate('ApplicationDetail', { id: a.id })}
                  />
                </View>
              ))}
            </Panel>
          ) : (
            <Board
              pool={pool}
              actions={actions}
              onOpen={(id) => navigation.navigate('ApplicationDetail', { id })}
              onDragChange={setBoardDragging}
            />
          )}
        </>
      )}

      <MenuSheet
        open={sortOpen}
        onClose={() => setSortOpen(false)}
        title="Sort by"
        description="Pick the column, then which end of it goes on top."
        actions={[
          ...SORTS.map((option) => ({
            id: option.value,
            label: option.label,
            checked: option.value === sort,
            onPress: () => setSort(option.value),
          })),
          {
            id: 'direction',
            // Named for what the list will look like rather than for the
            // direction, and it names the state it is about to move to.
            label: dir === 'asc' ? activeSort.desc : activeSort.asc,
            icon: dir === 'asc' ? 'arrow-down' : 'arrow-up',
            hint: `Currently ${dir === 'asc' ? activeSort.asc.toLowerCase() : activeSort.desc.toLowerCase()}`,
            onPress: () => setDir((d) => (d === 'asc' ? 'desc' : 'asc')),
          },
        ]}
      />

      <RoleFilterSheet open={rolesOpen} onClose={() => setRolesOpen(false)} />

      {actions.confirmSheet}
    </Screen>
  )
}

/* --------------------------------- rows ---------------------------------- */

function NextDate({ item }: { item?: TimelineItem }) {
  if (!item) {
    return (
      <Txt size="xs" tone="muted">
        —
      </Txt>
    )
  }
  // Colour law: red is past due and nothing else, amber is the next 48 hours and
  // nothing else. Everything further out is plain text, however important.
  const gap = daysBetween(TODAY, item.date)
  const tone = gap < 0 ? 'danger' : gap <= 1 ? 'warning' : 'muted'
  return (
    <Txt size="xs" tone={tone} mono>
      {shortDate(item.date)}
    </Txt>
  )
}

function ApplicationRow({
  application: a,
  nextDate,
  showNote,
  actions,
  onOpen,
}: {
  application: Application
  nextDate?: TimelineItem
  showNote: boolean
  actions: RowActions
  onOpen: () => void
}) {
  const c = useColors()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={displayName(a)}
        onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, pressed && { backgroundColor: c.rowHover }]}
      >
        <View style={s.row}>
          <Txt size="base" weight="medium" style={s.fill} numberOfLines={1}>
            {displayName(a)}
          </Txt>
          {a.flagged ? <Feather name="flag" size={14} color={c.danger} /> : null}
          <NextDate item={nextDate} />
        </View>

        {showNote && a.note ? (
          <Txt size="xs" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
            {a.note}
          </Txt>
        ) : null}

        <View style={styles.rowMeta}>
          <StagePicker
            value={a.stage}
            name={displayName(a)}
            onSelect={(stage) => actions.onMoveStage(a, stage)}
          />
          <Chip size="sm" tone="gray">
            {a.roleTag}
          </Chip>
          <LabelChips recordId={refKey('app', a.id)} />
          <View style={s.fill} />
          <Txt size="xs" tone="muted" mono>
            {activityLabel(a.daysAgo)}
          </Txt>
        </View>
      </Pressable>

      <IconButton
        icon="more-horizontal"
        label={`More actions for ${displayName(a)}`}
        onPress={() => setMenuOpen(true)}
      />

      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={displayName(a)}
        description={`${STAGE_LABEL[a.stage]} · ${a.roleTag}`}
        actions={[
          { id: 'open', label: 'Open record', icon: 'arrow-right', onPress: onOpen },
          { id: 'edit', label: 'Edit', icon: 'edit-2', onPress: () => actions.onEdit(a) },
          {
            id: 'flag',
            label: a.flagged ? 'Clear the follow-up flag' : 'Flag for follow-up',
            icon: 'flag',
            onPress: () => actions.onFlag(a),
          },
          {
            id: 'duplicate',
            label: 'Duplicate',
            icon: 'copy',
            onPress: () => actions.onDuplicate(a),
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: 'trash-2',
            tone: 'danger',
            onPress: () => actions.requestDelete(a),
          },
        ]}
      />
    </View>
  )
}

/* ------------------------------ role filter ------------------------------ */

/**
 * The global role filter, scoped to the one list it changes.
 *
 * It used to be pinned in the top bar, where it changed two of a dozen surfaces
 * and left every number on the dashboard ambiguous about whether it counted the
 * whole search.
 */
function RoleFilterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { selected, toggle, clear } = useRoles()
  const { all } = useApplications()

  const countOf = (role: RoleTag) => all.filter((a) => a.roleTag === role).length

  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      title="Filter by role"
      description="Nothing selected means everything — clearing the filter is the same as never having set one."
      actions={[
        ...ROLES.map((role) => ({
          id: role,
          label: role,
          hint: `${countOf(role)} tracked`,
          checked: selected.has(role),
          onPress: () => toggle(role),
        })),
        ...(selected.size > 0
          ? [{ id: 'clear', label: 'Show every role', icon: 'x' as const, onPress: clear }]
          : []),
      ]}
    />
  )
}

/* ------------------------------ paste a URL ------------------------------ */

/**
 * Start a record from a posting URL.
 *
 * Nothing is fetched — the employer and role are guessed from the URL itself
 * and handed to the create sheet as a prefill the user still has to look at.
 */
function PasteUrlRow() {
  const { open } = useSheets()
  const [url, setUrl] = useState('')

  const submit = () => {
    const text = url.trim()
    if (!text) return
    open('application', { initial: draftFromUrl(text) })
    setUrl('')
  }

  return (
    <View style={s.row}>
      <View style={s.fill}>
        <SearchInput
          label="Posting URL"
          value={url}
          onChange={setUrl}
          placeholder="Paste a posting URL"
        />
      </View>
      <Button label="From link" size="md" disabled={!url.trim()} onPress={submit} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: space[2] },
  rowMain: { flex: 1, minWidth: 0, paddingVertical: space[3], paddingLeft: space[4] },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[1.5],
    marginTop: space[2],
  },
})
