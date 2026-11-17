import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Feather } from '@react-native-vector-icons/feather/static'
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
import { STAGES, STAGE_LABEL, displayName } from '@jojo/service/data/seed'
import { useRoleVocabulary } from '@jojo/service/react/use-roles'
import type { Application, RoleTag, Stage } from '@jojo/service/data/seed'
import { addDays, compareItems, daysBetween } from '@jojo/service/data/timeline'
import type { TimelineItem } from '@jojo/service/data/timeline'
import { TODAY } from '@/lib/today'
// The parser is the shared one. `src/lib/draft-from.ts` held a 349-line copy of
// it that was never tested here; the two were checked input for input before it
// was deleted. `scout.posting.promote` parses a posting's URL through this same
// module with no screen in the call stack, so a second copy up here could only
// ever disagree with the store about what a pasted link means.
import { draftFromShare, draftFromUrl } from '@jojo/service/core/parse-posting'
import { sortApplications } from '@/lib/application-sort'
import type { SortDir, SortKey } from '@/lib/application-sort'
import { refKey } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import { useRoles } from '@/lib/roles-context'
import { useSheets } from '@/lib/sheets-context'
import { isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { matchesQuery } from '@/lib/search'
import { useApplications, useTimeline } from '@/lib/store-context'
import type { RootStackParamList, TabParamList } from '@/navigation/types'
import { Board } from '@/screens/applications/Board'
import { useRowActions } from '@/screens/applications/use-row-actions'
import type { RowActions } from '@/screens/applications/use-row-actions'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { TourTarget } from '@/components/tour/TourTarget'
import { domain as domainWords, useDomain } from '@/i18n/domain'

type View_ = 'list' | 'board'

/** The two layouts; their labels are catalog keys, translated where drawn. */
const VIEWS = ['list', 'board'] as const

/**
 * The three orderings, each with what its two directions actually mean.
 *
 * "Ascending" is meaningless to a reader deciding how to sort a list — what
 * they want to know is whether the newest or the oldest ends up on top. The
 * web version says this with an arrow on a column header; without a header row
 * to hang one on, the menu has to say it in words.
 */
const SORTS: { value: SortKey; key: 'activity' | 'stage' | 'position' }[] = [
  { value: 'daysAgo', key: 'activity' },
  { value: 'stage', key: 'stage' },
  { value: 'role', key: 'position' },
]

/**
 * The words come from `agoLabel`, so this column speaks the same past tense as
 * "Completed 3 days ago" in the Vault — including its two-week cut-off, past
 * which a count of days stops being information and the plain date is what you
 * would say out loud.
 */
function activityLabel(daysAgo: number) {
  const ago = domainWords.ago(addDays(TODAY, -daysAgo), TODAY)
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
  const { t, i18n } = useTranslation('screens')
  const domain = useDomain()
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

  /*
   * A share from another app lands here.
   *
   * `MainActivity` turns an `ACTION_SEND` into `jojo://applications?shared=…`
   * and the linking config turns that into this parameter, so a URL shared from
   * a browser arrives as an ordinary route param and nothing native reaches
   * into React. `draftFromUrl` handles a bare link and a scrap of text alike,
   * which matters because Android shares are usually a title AND a URL.
   *
   * Cleared as it is consumed. Without that, going back to this tab later would
   * reopen the sheet on a link the user already dealt with — a route param is
   * an instruction here, not a filter.
   */
  /*
   * A link that names a stage or a sort — a slice of Today's pipeline, a
   * glance counter — is followed even when this tab is already mounted, and
   * cleared once applied, as `shared` is below. Read only into the initial
   * state, a link into an already-visited Applications tab opened unfiltered.
   */
  const linkStage = route.params?.stage
  const linkSort = route.params?.sort
  useEffect(() => {
    if (linkStage === undefined && linkSort === undefined) return
    if (linkStage !== undefined) {
      setStageFilter(linkStage)
      // Stage chips are list-only, so a stage link shows the list.
      setView('list')
    }
    if (linkSort !== undefined) setSort(linkSort)
    navigation.setParams({ stage: undefined, sort: undefined })
  }, [linkStage, linkSort, navigation])

  const shared = route.params?.shared
  useEffect(() => {
    if (!shared) return
    navigation.setParams({ shared: undefined })
    open('application', { initial: draftFromShare(shared) })
  }, [shared, navigation, open])
  const [rolesOpen, setRolesOpen] = useState(false)
  const [showNotes, setShowNotes] = useState(true)
  // Lives here rather than in `Board` because the scroller it has to freeze is
  // the one `Screen` owns, two levels up from where the gesture happens.
  const [boardDragging, setBoardDragging] = useState(false)

  const { actions, confirmSheet } = useRowActions()

  /*
   * One callback for every row, rather than one closure per row per render.
   *
   * `onOpen={() => navigation.navigate(...)}` reads well and defeats `memo` on
   * the row completely: the arrow is a new function on every pass, so every row
   * saw a changed prop even when nothing about it had changed. The row takes the
   * id and calls this.
   */
  const openApplication = useCallback(
    (id: string) => navigation.navigate('ApplicationDetail', { id }),
    [navigation],
  )

  /**
   * The next dated thing per application, built once rather than filtered per
   * row — twelve rows each scanning the whole timeline is the shape that gets
   * slow the moment a real store is behind it.
   */
  const nextDates = useMemo(() => {
    const byApp = new Map<string, TimelineItem[]>()
    for (const item of timelineItems) {
      // One item can land in several buckets now that `ABOUT` is many-to-many:
      // a reference deadline that covers three jobs is the next dated thing on
      // all three, not on whichever id happened to be stored first.
      for (const appId of item.applicationIds) {
        const list = byApp.get(appId)
        if (list) list.push(item)
        else byApp.set(appId, [item])
      }
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
      // for "Muñoz" typed without the tilde still finds it. The stage both in
      // the English the record is written in and in the words on the chip.
      return matchesQuery(
        query,
        a.org,
        a.role,
        a.note,
        a.roleTag,
        STAGE_LABEL[a.stage],
        domain.stage(a.stage),
        a.location,
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language is what `domain` reads; a switch must re-run this
  }, [all, query, roleMatches, keywordMatches, domain, i18n.language])

  /**
   * Stage counts over the pool, not over everything. They used to be counted
   * before the search ran, so `All 8` sat above four rows.
   */
  const stageCounts = useMemo(() => {
    const map: Partial<Record<Stage, number>> = {}
    for (const a of pool) map[a.stage] = (map[a.stage] ?? 0) + 1
    return map
  }, [pool])

  /*
   * `dir` is in the body AND in the deps, and it was in neither.
   *
   * The comparator ignored it, so the toolbar arrow and the menu's "Oldest
   * first" were decoration over an order that never moved; and even once the
   * comparator read it, a memo keyed on `[pool, stageFilter, sort]` alone would
   * have served the old array back and kept the control inert. Two edits, one
   * bug — which is why the ordering itself now lives in `lib/application-sort`
   * where it can be run without a screen.
   */
  const rows = useMemo(() => {
    const filtered = stageFilter === 'all' ? pool : pool.filter((a) => a.stage === stageFilter)
    return sortApplications(filtered, sort, dir)
  }, [pool, stageFilter, sort, dir])

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
      query.trim() ? t('applications.empty.reasons.search') : '',
      stageFilter === 'all'
        ? ''
        : t('applications.empty.reasons.stage', { stage: domain.stage(stageFilter) }),
      selectedKeywords.size > 0 ? t('applications.empty.reasons.keywords') : '',
      selectedRoles.size > 0 ? t('applications.empty.reasons.roles') : '',
    ].filter(Boolean)
    if (on.length === 0) return t('applications.empty.nothing')
    const joined =
      on.length === 1
        ? on[0]
        : t('shared.list', {
            items: on.slice(0, -1).join(t('shared.separator')),
            last: on.at(-1),
          })
    return t('applications.empty.carries', { filters: joined })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language is what `domain` reads; a switch must re-run this
  }, [query, stageFilter, selectedKeywords, selectedRoles, t, domain, i18n.language])

  const activeSort = SORTS.find((option) => option.value === sort) ?? SORTS[0]
  const sortLabel = t(`applications.sorts.${activeSort.key}.label`)
  const sortAsc = t(`applications.sorts.${activeSort.key}.asc`)
  const sortDesc = t(`applications.sorts.${activeSort.key}.desc`)
  const views = VIEWS.map((value) => ({ value, label: t(`applications.views.${value}`) }))

  const clearFilters = () => {
    setQuery('')
    setStageFilter('all')
    clearSelected()
    clearRoles()
  }

  /*
   * Memoised. Built inline in the JSX it was a new array every render, so the
   * count map in `LabelFilter` never held and the pool was re-counted on every
   * keystroke — twice per keyword, on a device with no JIT.
   */
  const scopeIds = useMemo(() => pool.map((a) => refKey('app', a.id)), [pool])

  return (
    <Screen
      // Frozen while a board card is in the air. Without this the page can
      // scroll out from under the drag, and the floating card — positioned
      // against the board's measured origin — parts company with the finger.
      scrollEnabled={!boardDragging}
      openOptions={route.params?.options === true}
      onArrived={() => navigation.setParams({ options: undefined })}
      title={t('applications.title')}
      subtitle={
        empty
          ? t('applications.subtitleEmpty')
          : t('applications.subtitle', { shown, total: all.length })
      }
      actions={
        <Button label={t('applications.new')} icon="plus" onPress={() => open('application')} />
      }
      options={
        <SettingRow
          label={t('applications.showNotes')}
          description={t('applications.showNotesDescription')}
          control={
            <Toggle
              value={showNotes}
              onValueChange={setShowNotes}
              label={t('applications.showNotes')}
            />
          }
        />
      }
    >
      {empty ? (
        <Panel>
          <EmptyState
            icon="clipboard"
            title={t('applications.none.title')}
            description={t('applications.none.description')}
            action={
              <Button
                label={t('applications.newApplication')}
                icon="plus"
                onPress={() => open('application')}
              />
            }
          />
        </Panel>
      ) : (
        <>
          <PasteUrlRow />

          <SearchInput
            label={t('applications.searchLabel')}
            value={query}
            onChange={setQuery}
            placeholder={t('applications.searchPlaceholder')}
          />

          <View style={s.row}>
            {/* Marked for the guided tour, which asks for the board. */}
            <TourTarget id="layout" state={view} style={s.fill}>
              <Segment
                label={t('applications.layout')}
                options={views}
                value={view}
                onChange={setView}
              />
            </TourTarget>
            <IconButton
              icon="filter"
              label={t('applications.filterByRole')}
              active={selectedRoles.size > 0}
              onPress={() => setRolesOpen(true)}
            />
            {view === 'list' ? (
              <IconButton
                icon={dir === 'asc' ? 'arrow-down' : 'arrow-up'}
                label={t('applications.sortButton', {
                  sort: sortLabel,
                  order: dir === 'asc' ? sortAsc : sortDesc,
                })}
                onPress={() => setSortOpen(true)}
              />
            ) : null}
          </View>

          {/* Scoped to the pool on screen. Without it a chip here would count
              every reminder and vault file carrying that keyword too. */}
          <LabelFilter scopeIds={scopeIds} />

          {/* Stage chips are list-only: the board is already grouped by stage,
              so filtering there blanks five columns rather than shortening a
              list. */}
          {view === 'list' ? (
            <BucketFilter
              label={t('applications.filterByStage')}
              options={STAGES.map((s) => s.id)}
              labels={
                Object.fromEntries(STAGES.map((s) => [s.id, domain.stage(s.id)])) as Record<
                  Stage,
                  string
                >
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
                title={t('applications.empty.title')}
                description={emptyReason}
                action={
                  <>
                    {anyFilter ? (
                      <Button
                        label={t('applications.empty.showAll', { count: all.length })}
                        icon="x"
                        variant="outline"
                        onPress={clearFilters}
                      />
                    ) : null}
                    <Button
                      label={t('applications.newApplication')}
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
            <TourTarget id="records">
              <Panel padded={false}>
                {rows.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 ? <Divider /> : null}
                    <ApplicationRow
                      application={a}
                      nextDate={nextDates.get(a.id)}
                      showNote={showNotes}
                      actions={actions}
                      onOpen={openApplication}
                    />
                  </View>
                ))}
              </Panel>
            </TourTarget>
          ) : (
            <TourTarget id="records">
              <Board
                pool={pool}
                actions={actions}
                onOpen={openApplication}
                onDragChange={setBoardDragging}
              />
            </TourTarget>
          )}
        </>
      )}

      <MenuSheet
        open={sortOpen}
        onClose={() => setSortOpen(false)}
        title={t('applications.sortMenu.title')}
        description={t('applications.sortMenu.description')}
        actions={[
          ...SORTS.map((option) => ({
            id: option.value,
            label: t(`applications.sorts.${option.key}.label`),
            checked: option.value === sort,
            onPress: () => setSort(option.value),
          })),
          {
            id: 'direction',
            // Named for what the list will look like rather than for the
            // direction, and it names the state it is about to move to.
            label: dir === 'asc' ? sortDesc : sortAsc,
            icon: dir === 'asc' ? 'arrow-down' : 'arrow-up',
            hint: t('applications.sortMenu.currently', {
              order: dir === 'asc' ? sortAsc : sortDesc,
            }),
            onPress: () => setDir((d) => (d === 'asc' ? 'desc' : 'asc')),
          },
        ]}
      />

      <RoleFilterSheet open={rolesOpen} onClose={() => setRolesOpen(false)} />

      {confirmSheet}
    </Screen>
  )
}

/* --------------------------------- rows ---------------------------------- */

function NextDate({ item }: { item?: TimelineItem }) {
  const domain = useDomain()
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
      {domain.shortDate(item.date)}
    </Txt>
  )
}

/*
 * Memoised, and it only pays off because everything above hands it stable
 * props: `actions` is a `useMemo` in `use-row-actions`, `onOpen` is one
 * callback for the whole list, and `application` comes straight off a
 * projection. Break any of those three and this `memo` silently stops working —
 * it will still compare, always find something new, and re-render anyway.
 */
const ApplicationRow = memo(function ApplicationRow({
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
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={displayName(a)}
        onPress={() => onOpen(a.id)}
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
        label={t('applications.row.moreActions', { name: displayName(a) })}
        onPress={() => setMenuOpen(true)}
      />

      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={displayName(a)}
        description={`${domain.stage(a.stage)} · ${a.roleTag}`}
        actions={[
          {
            id: 'open',
            label: t('applications.row.open'),
            icon: 'arrow-right',
            onPress: () => onOpen(a.id),
          },
          {
            id: 'edit',
            label: t('applications.row.edit'),
            icon: 'edit-2',
            onPress: () => actions.onEdit(a),
          },
          {
            id: 'flag',
            label: a.flagged ? t('applications.row.unflag') : t('applications.row.flag'),
            icon: 'flag',
            onPress: () => actions.onFlag(a),
          },
          {
            id: 'duplicate',
            label: t('applications.row.duplicate'),
            icon: 'copy',
            onPress: () => actions.onDuplicate(a),
          },
          {
            id: 'delete',
            label: t('shared.delete'),
            icon: 'trash-2',
            tone: 'danger',
            onPress: () => actions.requestDelete(a),
          },
        ]}
      />
    </View>
  )
})

/* ------------------------------ role filter ------------------------------ */

/**
 * The global role filter, scoped to the one list it changes.
 *
 * It used to be pinned in the top bar, where it changed two of a dozen surfaces
 * and left every number on the dashboard ambiguous about whether it counted the
 * whole search.
 */
function RoleFilterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('screens')
  const vocabulary = useRoleVocabulary()
  const { selected, toggle, clear } = useRoles()
  const { all } = useApplications()

  const countOf = (role: RoleTag) => all.filter((a) => a.roleTag === role).length

  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      title={t('applications.filterByRole')}
      description={t('applications.roles.description')}
      actions={[
        ...vocabulary.map((role) => ({
          id: role,
          label: role,
          hint: t('applications.roles.tracked', { count: countOf(role) }),
          checked: selected.has(role),
          onPress: () => toggle(role),
        })),
        ...(selected.size > 0
          ? [
              {
                id: 'clear',
                label: t('applications.roles.clear'),
                icon: 'x' as const,
                onPress: clear,
              },
            ]
          : []),
      ]}
    />
  )
}

/* ------------------------------ paste a URL ------------------------------ */

/**
 * Start a record from a posting URL.
 *
 * With a model connected the page is READ — the reader sheet opens on this URL
 * and starts, so the model fills the form from the posting. Without one, the
 * employer and role are guessed from the URL itself and handed to the create
 * sheet as a prefill the user still has to look at. Web's `AddByUrl` makes the
 * same choice for the same reason; see there.
 */
function PasteUrlRow() {
  const { t } = useTranslation('screens')
  const { open } = useSheets()
  const { settings } = useModelSettings()
  const connected = isConfigured(settings)
  const [url, setUrl] = useState('')

  const submit = () => {
    const text = url.trim()
    if (!text) return
    if (connected) open('applicationFromLink', { url: text, start: true })
    else open('application', { initial: draftFromUrl(text) })
    setUrl('')
  }

  return (
    <View style={s.row}>
      <View style={s.fill}>
        <SearchInput
          label={t('applications.paste.label')}
          value={url}
          onChange={setUrl}
          placeholder={t('applications.paste.placeholder')}
        />
      </View>
      <Button
        label={t('applications.paste.submit')}
        size="md"
        disabled={!url.trim()}
        onPress={submit}
      />
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
