import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TODAY } from '@/lib/today'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { FiledUnderLinks } from '@/components/common/FiledUnderLinks'
import { ItemMenu, SnoozeMenu } from '@/components/common/ItemMenus'
import { LabelChips } from '@/components/common/Labels'
import { BucketFilter } from '@/components/ui/BucketFilter'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { Divider, Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { bucketOf } from '@jojo/service/data/timeline'
import type { TimelineBucket, TimelineItem } from '@jojo/service/data/timeline'
import { useLabels } from '@/lib/labels-context'
import { vaultEmptyState } from '@/lib/vault-empty'
import { matchesQuery } from '@/lib/search'
import { useSheets } from '@/lib/sheets-context'
import { useTimeline } from '@/lib/store-context'
import { KIND_ICON, KIND_LABEL } from '@/lib/timeline-visuals'
import { useItemActions } from '@/lib/use-item-actions'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'
import { FocusTarget } from '@/components/ui/FocusTarget'

const BUCKETS: TimelineBucket[] = ['overdue', 'today', 'upcoming', 'done']

const BUCKET_TONE = {
  overdue: 'danger',
  today: 'warning',
  upcoming: 'muted',
  done: 'muted',
} as const

/**
 * The reminders list.
 *
 * Every write goes through `useItemActions`, which is the same hook Today's
 * week list and the Calendar's day list use — so a row behaves identically
 * whichever of the three you are looking at, and an undo puts the keywords back
 * wherever it is pressed.
 */
export function RemindersTool() {
  const { t, i18n } = useTranslation('vault')
  const domain = useDomain()
  // Built per render rather than at module scope, so a language change reaches it.
  const bucketLabel: Record<TimelineBucket, string> = {
    overdue: t('reminders.buckets.overdue'),
    today: t('reminders.buckets.today'),
    upcoming: t('reminders.buckets.upcoming'),
    done: t('reminders.buckets.done'),
  }
  const c = useColors()
  const { reminders } = useTimeline()
  const { matches, selected, clearSelected } = useLabels()
  const { open } = useSheets()
  const actions = useItemActions()

  const [bucket, setBucket] = useState<TimelineBucket | 'all'>('all')
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<TimelineItem | null>(null)
  const [snoozing, setSnoozing] = useState<TimelineItem | null>(null)

  // The kind both in core's English and in the words on screen, so either finds it.
  const pool = useMemo(
    () =>
      reminders.filter(
        (r) =>
          matches(r.id) &&
          matchesQuery(query, r.title, r.detail, r.note, KIND_LABEL[r.kind], domain.kind(r.kind)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language is what `domain` reads; a switch must re-run this
    [reminders, query, matches, domain, i18n.language],
  )

  const counts = useMemo(() => {
    const map: Partial<Record<TimelineBucket, number>> = {}
    for (const r of pool) {
      const b = bucketOf(r, TODAY)
      map[b] = (map[b] ?? 0) + 1
    }
    return map
  }, [pool])

  const rows = bucket === 'all' ? pool : pool.filter((r) => bucketOf(r, TODAY) === bucket)

  const addButton = (
    <Button
      label={t('reminders.add')}
      icon="plus"
      onPress={() => open('timelineItem', { mode: 'reminder' })}
    />
  )

  const empty = vaultEmptyState({
    total: reminders.length,
    query,
    filteredByBucket: bucket !== 'all',
    filteredByKeyword: selected.size > 0,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setBucket('all'),
    onClearKeywords: clearSelected,
    copy: {
      icon: 'bell',
      zero: {
        title: t('reminders.empty.zeroTitle'),
        description: t('reminders.empty.zeroDescription'),
      },
      search: (q) => t('reminders.empty.search', { query: q }),
      // One sentence per group: an adjective dropped into a fixed frame does
      // not survive translation.
      both: bucket === 'all' ? '' : t(`reminders.empty.both.${bucket}`),
      // Done is the one bucket that is not a deadline passing: an empty Done
      // list is not a filter hiding work, so it says something else.
      bucket:
        bucket === 'done'
          ? {
              icon: 'check',
              title: t('reminders.empty.doneTitle'),
              description: t('reminders.empty.doneDescription'),
              clearLabel: t('reminders.empty.showAll'),
            }
          : {
              title: bucket === 'all' ? '' : t(`reminders.empty.nothingIn.${bucket}`),
              description: t('reminders.empty.bucketDescription', { count: reminders.length }),
              clearLabel: t('reminders.empty.showAll'),
            },
      keywords: { title: t('reminders.empty.keywordsTitle') },
    },
  })

  return (
    <>
      <SearchInput
        label={t('reminders.search.label')}
        value={query}
        onChange={setQuery}
        placeholder={t('reminders.search.placeholder')}
      />
      <BucketFilter
        label={t('reminders.filterLabel')}
        options={BUCKETS}
        labels={bucketLabel}
        counts={counts}
        value={bucket}
        onChange={setBucket}
        total={pool.length}
      />
      <Button
        label={t('reminders.add')}
        icon="plus"
        onPress={() => open('timelineItem', { mode: 'reminder' })}
      />

      <Panel padded={false}>
        {rows.length === 0 ? (
          <View style={{ padding: space[4] }}>
            <EmptyState
              icon={empty.icon}
              title={empty.title}
              description={empty.description}
              action={
                empty.clear ? (
                  <Button
                    label={empty.clear.label}
                    variant="outline"
                    onPress={empty.clear.onPress}
                  />
                ) : (
                  addButton
                )
              }
            />
          </View>
        ) : (
          rows.map((r, i) => {
            const b = bucketOf(r, TODAY)
            const done = Boolean(r.completedOn)
            const when = domain.when(r, TODAY)
            const date = domain.shortDate(r.date)

            return (
              <FocusTarget key={r.id} id={r.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    accessibilityLabel={
                      done
                        ? t('reminders.markNotDone', { title: r.title })
                        : t('reminders.markDone', { title: r.title })
                    }
                    onPress={() => actions.complete(r)}
                    hitSlop={8}
                    style={[
                      styles.checkbox,
                      {
                        borderColor: done ? c.accent : c.hairlineStrong,
                        backgroundColor: done ? c.accent : 'transparent',
                      },
                    ]}
                  >
                    {done ? <Feather name="check" size={13} color={c.accentFg} /> : null}
                  </Pressable>

                  <Feather
                    name={KIND_ICON[r.kind]}
                    size={15}
                    color={c.text3}
                    style={{ marginTop: 3 }}
                  />

                  {/* The date reads under the title rather than in a column
                      beside it. A right-hand column is content-sized and never
                      shrinks, so at 393pt it left the title about 180pt — long
                      enough to wrap "Confirm application was received" onto two
                      lines and set the urgency ragged beside it. Leading the
                      meta line with the same words keeps "8 days overdue" the
                      first thing read after the title, and gives the title the
                      whole row. */}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => actions.edit(r)}
                    style={s.fill}
                  >
                    <Txt
                      size="sm"
                      tone={done ? 'muted' : 'primary'}
                      style={done ? s.struck : undefined}
                    >
                      {r.title}
                    </Txt>
                    <Txt size="xs" tone="muted" numberOfLines={1}>
                      <Txt size="xs" weight="medium" tone={BUCKET_TONE[b]}>
                        {when}
                      </Txt>
                      {/* The date only earns its place when the label is
                          relative. Past the two-week cut-off `agoLabel` returns
                          a plain date, so a row ticked off on its due day read
                          "Completed Sep 28 · Sep 28". */}
                      {when.includes(date) ? '' : ` · ${date}`}
                      {r.detail || r.note ? ` · ${r.detail ?? r.note}` : ''}
                    </Txt>
                    <FiledUnderLinks applicationIds={r.applicationIds} />
                    <LabelChips recordId={r.id} />
                  </Pressable>

                  <IconButton
                    icon="more-horizontal"
                    label={t('common.moreActionsFor', { name: r.title })}
                    onPress={() => setMenuFor(r)}
                  />
                </View>
              </FocusTarget>
            )
          })
        )}
      </Panel>

      <ItemMenu
        item={menuFor}
        actions={actions}
        onClose={() => setMenuFor(null)}
        onSnooze={setSnoozing}
      />
      <SnoozeMenu item={snoozing} actions={actions} onClose={() => setSnoozing(null)} />
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingVertical: space[3],
    paddingLeft: space[4],
    paddingRight: space[2],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
})
