import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TODAY } from '@/lib/today'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { LabelChips, LabelPicker } from '@/components/common/Labels'
import {
  ApplicationField,
  ApplicationPickerSheet,
} from '@/components/common/ApplicationPickerSheet'
import { FiledUnderLinks } from '@/components/common/FiledUnderLinks'
import { buildRecordMenu } from '@/components/common/recordMenu'
import { BucketFilter } from '@/components/ui/BucketFilter'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormField, TextField } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { SearchInput } from '@/components/ui/SearchInput'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { Divider, Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@jojo/service/data/seed'
import { LINK_CATEGORIES } from '@jojo/service/data/vault'
import type { LinkCategory, VaultLink } from '@jojo/service/data/vault'
import { useLabels } from '@/lib/labels-context'
import { vaultEmptyState } from '@/lib/vault-empty'
import { matchesQuery } from '@/lib/search'
import { useApplications, useVault } from '@/lib/store-context'
import { capitalize } from '@/lib/text'
import { useCopy } from '@/lib/use-copy'
import { displayUrl, hrefOf, normalizeUrl } from '@/lib/urls'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'
import { report } from '@/lib/analytics'
import { useDomain } from '@/i18n/domain'
import { FocusTarget } from '@/components/ui/FocusTarget'
import { useArrivingFocus } from '@/components/ui/focus-scope'
import { ShowMoreRows } from '@/components/ui/ShowMoreRows'
import { useDiscardGuard } from '@/components/ui/discard-guard'
import { indexOfId, useRowCap } from '@/lib/use-row-cap'

/** Postings, department pages, people and guides — anything to come back to. */
export function LinksTool() {
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const { links, addLink, updateLink, removeLink } = useVault()
  const { byId } = useApplications()
  const { matches, selected, clearSelected } = useLabels()
  const { toast } = useToast()
  const { copy } = useCopy()

  const [category, setCategory] = useState<LinkCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<VaultLink | 'new' | null>(null)
  // The row's own way to file this under a job — the same action the files
  // list carries, because the gap was identical here. An ID rather than the
  // record, because the picker is a multi-select that stays open across taps
  // and has to be reading what the link says now, not when it opened.
  const [filing, setFiling] = useState<string | null>(null)
  const filingLink = links.find((l) => l.id === filing) ?? null
  const [menuFor, setMenuFor] = useState<VaultLink | null>(null)

  // The employer is part of the haystack — searching "Rice" should surface the
  // links filed under it, not only the ones with Rice in the title. `byId` is
  // read inside the memo rather than through a closure, so the dependency the
  // filter actually has is the one declared.
  const pool = useMemo(
    () =>
      links.filter(
        (l) =>
          matches(l.id) &&
          matchesQuery(
            query,
            l.title,
            l.url,
            l.note,
            l.category,
            ...l.applicationIds.map((id) => byId.get(id)?.org),
          ),
      ),
    [links, query, matches, byId],
  )

  const counts = useMemo(() => {
    const map: Partial<Record<LinkCategory, number>> = {}
    for (const l of pool) map[l.category] = (map[l.category] ?? 0) + 1
    return map
  }, [pool])

  const rows = category === 'all' ? pool : pool.filter((l) => l.category === category)
  // A page of rows at a time, always including the row a search result or a
  // Filed panel arrived at (`useRowCap`, `useArrivingFocus`).
  const arriving = useArrivingFocus()
  const cap = useRowCap(rows.length, indexOfId(rows, arriving))

  const onDelete = (l: VaultLink) => {
    const { restore } = removeLink(l.id)
    toast({
      title: t('links.toast.removed'),
      description: l.title,
      tone: 'danger',
      action: { label: t('common.undo'), onPress: restore },
    })
  }

  const onDuplicate = (l: VaultLink) => {
    const { id: _id, savedOn: _savedOn, ...rest } = l
    const copyRecord = addLink({ ...rest, title: t('common.copyOf', { name: l.title }) })
    toast({
      title: t('links.toast.duplicated'),
      description: copyRecord.title,
      action: { label: t('common.undo'), onPress: () => removeLink(copyRecord.id) },
    })
  }

  /** Sets the whole list — `FILED_UNDER` is many, so unticking the last unfiles it. */
  const onFileUnder = (record: VaultLink, applicationIds: string[]) => {
    const before = record.applicationIds
    updateLink(record.id, { applicationIds })
    const chosen = applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
    toast({
      title: capitalize(domain.filedUnder(chosen.map(displayName))),
      description: record.title,
      action: {
        label: t('common.undo'),
        onPress: () => updateLink(record.id, { applicationIds: before }),
      },
    })
  }

  const onMove = (l: VaultLink, next: LinkCategory) => {
    const before = l.category
    updateLink(l.id, { category: next })
    toast({
      title: t('common.movedTo', { name: domain.linkCategory(next) }),
      description: l.title,
      action: { label: t('common.undo'), onPress: () => updateLink(l.id, { category: before }) },
    })
  }

  const addButton = <Button label={t('links.add')} icon="plus" onPress={() => setEditing('new')} />

  const empty = vaultEmptyState({
    total: links.length,
    query,
    filteredByBucket: category !== 'all',
    filteredByKeyword: selected.size > 0,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setCategory('all'),
    onClearKeywords: clearSelected,
    copy: {
      icon: 'link-2',
      zero: {
        title: t('links.empty.zeroTitle'),
        description: t('links.empty.zeroDescription'),
      },
      search: (q) => t('links.empty.search', { query: q }),
      both: t('links.empty.both', { category: domain.linkCategory(category) }),
      bucket: {
        title: t('links.empty.bucketTitle', { category: domain.linkCategory(category) }),
        description: t('links.empty.bucketDescription', { count: links.length }),
        clearLabel: t('links.empty.showAll'),
      },
      keywords: { title: t('links.empty.keywordsTitle') },
    },
  })

  return (
    <>
      <SearchInput
        label={t('links.search.label')}
        value={query}
        onChange={setQuery}
        placeholder={t('links.search.placeholder')}
      />
      <BucketFilter
        label={t('links.filterLabel')}
        options={LINK_CATEGORIES}
        labels={
          Object.fromEntries(LINK_CATEGORIES.map((k) => [k, domain.linkCategory(k)])) as Record<
            LinkCategory,
            string
          >
        }
        counts={counts}
        value={category}
        onChange={setCategory}
        total={pool.length}
      />
      <Button label={t('links.add')} icon="plus" onPress={() => setEditing('new')} />

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
          rows.slice(0, cap.shown).map((l, i) => {
            return (
              <FocusTarget key={l.id} id={l.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={t('common.openNamed', { name: l.title })}
                    onPress={() => Linking.openURL(hrefOf(l.url))}
                    style={s.fill}
                  >
                    <Txt size="sm" weight="medium" numberOfLines={2}>
                      {l.title}
                    </Txt>
                    <Txt size="xs" tone="muted" mono numberOfLines={1}>
                      {displayUrl(l.url)} ·{' '}
                      {t('common.savedAgo', { ago: domain.ago(l.savedOn, TODAY) })}
                    </Txt>
                    {l.note ? (
                      <Txt size="xs" tone="muted" numberOfLines={2}>
                        {l.note}
                      </Txt>
                    ) : null}
                    <FiledUnderLinks applicationIds={l.applicationIds} />
                    <View style={styles.chips}>
                      <Chip size="sm" tone="gray">
                        {domain.linkCategory(l.category)}
                      </Chip>
                      <LabelChips recordId={l.id} />
                    </View>
                  </Pressable>
                  <LabelPicker recordId={l.id} name={l.title} />
                  <IconButton
                    icon="more-horizontal"
                    label={t('common.moreActionsFor', { name: l.title })}
                    onPress={() => setMenuFor(l)}
                  />
                </View>
              </FocusTarget>
            )
          })
        )}
        <ShowMoreRows shown={cap.shown} hidden={cap.hidden} onMore={cap.more} />
      </Panel>

      <ApplicationPickerSheet
        open={filingLink !== null}
        values={filingLink?.applicationIds ?? []}
        onClose={() => setFiling(null)}
        onChange={(ids) => {
          if (filingLink) onFileUnder(filingLink, ids)
        }}
      />

      <MenuSheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.title}
        description={menuFor ? displayUrl(menuFor.url) : undefined}
        actions={
          menuFor
            ? buildRecordMenu({
                onEdit: () => setEditing(menuFor),
                editLabel: t('common.edit'),
                onDuplicate: () => onDuplicate(menuFor),
                extra: [
                  {
                    id: 'file-under',
                    label:
                      menuFor.applicationIds.length > 0
                        ? t('common.changeApplications')
                        : t('common.fileUnderApplication'),
                    icon: 'briefcase',
                    onPress: () => setFiling(menuFor.id),
                  },
                  {
                    id: 'open',
                    label: t('links.menu.open'),
                    icon: 'external-link',
                    onPress: () => Linking.openURL(hrefOf(menuFor.url)),
                  },
                  {
                    id: 'copy',
                    label: t('links.menu.copy'),
                    icon: 'copy',
                    onPress: async () => {
                      await copy(menuFor.url)
                      toast({
                        title: t('links.toast.copied'),
                        description: displayUrl(menuFor.url),
                      })
                    },
                  },
                ],
                move: {
                  label: t('links.category'),
                  options: LINK_CATEGORIES,
                  say: domain.linkCategory,
                  current: menuFor.category,
                  onMove: (next) => onMove(menuFor, next),
                },
                onDelete: () => onDelete(menuFor),
                deleteLabel: t('common.remove'),
              })
            : []
        }
      />

      {editing ? (
        <LinkEditor
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            if (editing !== 'new') {
              updateLink(editing.id, draft)
              toast({ title: t('links.toast.updated'), description: draft.title })
            } else {
              addLink(draft)
              void report('vault_item_added', { kind: 'link' })
              toast({ title: t('links.toast.saved'), description: draft.title })
            }
            setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}

function LinkEditor({
  initial,
  onClose,
  onSave,
}: {
  initial?: VaultLink
  onClose: () => void
  onSave: (draft: Omit<VaultLink, 'id' | 'savedOn'>) => void
}) {
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [category, setCategory] = useState<LinkCategory>(initial?.category ?? 'Posting')
  const [applicationIds, setApplicationIds] = useState<readonly string[]>(
    initial?.applicationIds ?? [],
  )
  const [attempted, setAttempted] = useState(false)
  // Anything typed that closing would take with it — see `useDiscardGuard`.
  const typed = JSON.stringify([title, url, note, category, applicationIds])
  const [opened] = useState(typed)
  const { close, guard } = useDiscardGuard(typed !== opened, onClose)

  const submit = () => {
    setAttempted(true)
    if (!title.trim() || !url.trim()) return
    onSave({
      title: title.trim(),
      url: normalizeUrl(url),
      note: note.trim() || undefined,
      category,
      applicationIds: [...applicationIds],
    })
  }

  return (
    <Sheet
      open
      onClose={close}
      title={initial ? t('links.editor.editTitle') : t('links.add')}
      description={t('links.editor.description')}
      footer={
        <>
          <Button label={t('common.cancel')} variant="ghost" size="md" onPress={close} />
          <Button
            label={initial ? t('common.save') : t('links.editor.saveLink')}
            size="md"
            onPress={submit}
          />
        </>
      }
    >
      <View style={{ gap: space[3.5], paddingBottom: space[2] }}>
        <TextField
          label={t('common.title')}
          required
          value={title}
          error={attempted && !title.trim() ? t('common.titleRequired') : undefined}
          placeholder={t('links.editor.titlePlaceholder')}
          onChangeText={setTitle}
        />
        <TextField
          label={t('links.editor.url')}
          required
          mono
          autoCapitalize="none"
          keyboardType="url"
          value={url}
          error={attempted && !url.trim() ? t('links.editor.urlRequired') : undefined}
          placeholder="jobs.rice.edu/postings/…"
          onChangeText={setUrl}
        />
        <FormField label={t('links.category')}>
          <Segment
            label={t('links.category')}
            scroll
            options={LINK_CATEGORIES.map((k) => ({ value: k, label: domain.linkCategory(k) }))}
            value={category}
            onChange={setCategory}
          />
        </FormField>

        {/* The edge that makes a link worth filing. Without it the Vault is a
            bookmark folder; with it, the application's own screen can count
            what is filed under it and a delete knows what to unlink. */}
        <ApplicationField
          values={applicationIds}
          onChange={setApplicationIds}
          hint={t('links.editor.applicationHint')}
        />

        <TextField
          label={t('common.note')}
          value={note}
          multiline
          placeholder={t('links.editor.notePlaceholder')}
          onChangeText={setNote}
        />
      </View>

      {guard}
    </Sheet>
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[1.5],
    marginTop: space[1.5],
  },
})
