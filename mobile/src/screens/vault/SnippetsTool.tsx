import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Marked } from '@/components/ui/Marked'
import { stripMarks } from '@jojo/service/core/marks'
import { StyleSheet, View } from 'react-native'
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
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { Sheet } from '@/components/ui/Sheet'
import { Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@jojo/service/data/seed'
import { SNIPPET_TAGS } from '@jojo/service/data/vault'
import type { Snippet, SnippetTag } from '@jojo/service/data/vault'
import { useLabels } from '@/lib/labels-context'
import { vaultEmptyState } from '@/lib/vault-empty'
import { matchesQuery } from '@/lib/search'
import { useApplications, useVault } from '@/lib/store-context'
import { capitalize } from '@/lib/text'
import { useCopy } from '@/lib/use-copy'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'
import { report } from '@/lib/analytics'
import { useDomain } from '@/i18n/domain'
import { FocusTarget } from '@/components/ui/FocusTarget'
import { useArrivingFocus } from '@/components/ui/focus-scope'
import { ShowMoreRows } from '@/components/ui/ShowMoreRows'
import { indexOfId, useRowCap } from '@/lib/use-row-cap'

/**
 * The answers you retype on every form.
 *
 * Copying is the whole point, so it is the one action promoted out of the
 * overflow onto the card. Everything else — edit, duplicate, retag, delete —
 * lives behind the ⋯ in the order every list in the app uses.
 */
export function SnippetsTool() {
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const { snippets, addSnippet, duplicateSnippet, updateSnippet, removeSnippet } = useVault()
  // Named for the filing toast; the picker sheet reads the list itself.
  const { byId } = useApplications()
  const { matches, selected, clearSelected } = useLabels()
  const { toast } = useToast()
  const { copy, isCopied } = useCopy()

  const [tag, setTag] = useState<SnippetTag | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Snippet | 'new' | null>(null)
  // The row's own way to file this under a job — the same action the files
  // list carries, because the gap was identical here. An ID rather than the
  // record, because the picker is a multi-select that stays open across taps
  // and has to be reading what the snippet says now, not when it opened.
  const [filing, setFiling] = useState<string | null>(null)
  const filingSnippet = snippets.find((x) => x.id === filing) ?? null
  const [menuFor, setMenuFor] = useState<Snippet | null>(null)

  const pool = useMemo(
    () => snippets.filter((x) => matches(x.id) && matchesQuery(query, x.title, x.body, x.tag)),
    [snippets, query, matches],
  )

  const counts = useMemo(() => {
    const map: Partial<Record<SnippetTag, number>> = {}
    for (const x of pool) map[x.tag] = (map[x.tag] ?? 0) + 1
    return map
  }, [pool])

  const rows = tag === 'all' ? pool : pool.filter((x) => x.tag === tag)
  // A page of rows at a time, always including the row a search result or a
  // Filed panel arrived at (`useRowCap`, `useArrivingFocus`).
  const arriving = useArrivingFocus()
  const cap = useRowCap(rows.length, indexOfId(rows, arriving))

  const onDelete = (snippet: Snippet) => {
    const { restore } = removeSnippet(snippet.id)
    toast({
      title: t('snippets.toast.deleted'),
      description: snippet.title,
      tone: 'danger',
      action: { label: t('common.undo'), onPress: restore },
    })
  }

  const onDuplicate = (snippet: Snippet) => {
    // Through the tool, for the reason `duplicateSnippet` gives: spreading the
    // record carried `tailored` and the raw marks into a copy the person made.
    // One write, so one Undo puts it back.
    const copyTitle = t('common.copyOf', { name: snippet.title })
    const made = duplicateSnippet(snippet.id, copyTitle)
    toast({
      title: t('snippets.toast.duplicated'),
      description: copyTitle,
      action: { label: t('common.undo'), onPress: () => removeSnippet(made.id) },
    })
  }

  /** Sets the whole list — `FILED_UNDER` is many, so unticking the last unfiles it. */
  const onFileUnder = (record: Snippet, applicationIds: string[]) => {
    const before = record.applicationIds
    updateSnippet(record.id, { applicationIds })
    const chosen = applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
    toast({
      title: capitalize(domain.filedUnder(chosen.map(displayName))),
      description: record.title,
      action: {
        label: t('common.undo'),
        onPress: () => updateSnippet(record.id, { applicationIds: before }),
      },
    })
  }

  const onMove = (snippet: Snippet, next: SnippetTag) => {
    const before = snippet.tag
    updateSnippet(snippet.id, { tag: next })
    toast({
      title: t('snippets.toast.filedUnder', { tag: domain.snippetTag(next) }),
      description: snippet.title,
      action: {
        label: t('common.undo'),
        onPress: () => updateSnippet(snippet.id, { tag: before }),
      },
    })
  }

  const addButton = (
    <Button label={t('snippets.add')} icon="plus" onPress={() => setEditing('new')} />
  )

  const empty = vaultEmptyState({
    total: snippets.length,
    query,
    filteredByBucket: tag !== 'all',
    filteredByKeyword: selected.size > 0,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setTag('all'),
    onClearKeywords: clearSelected,
    copy: {
      icon: 'copy',
      zero: {
        title: t('snippets.empty.zeroTitle'),
        description: t('snippets.empty.zeroDescription'),
      },
      search: (q) => t('snippets.empty.search', { query: q }),
      both: t('snippets.empty.both', { tag: domain.snippetTag(tag) }),
      bucket: {
        title: t('snippets.empty.bucketTitle', { tag: domain.snippetTag(tag) }),
        description: t('snippets.empty.bucketDescription', { count: snippets.length }),
        clearLabel: t('snippets.empty.showAll'),
      },
      keywords: { title: t('snippets.empty.keywordsTitle') },
    },
  })

  return (
    <>
      <SearchInput
        label={t('snippets.search.label')}
        value={query}
        onChange={setQuery}
        placeholder={t('snippets.search.placeholder')}
      />
      <BucketFilter
        label={t('snippets.filterLabel')}
        options={SNIPPET_TAGS}
        labels={
          Object.fromEntries(SNIPPET_TAGS.map((k) => [k, domain.snippetTag(k)])) as Record<
            SnippetTag,
            string
          >
        }
        counts={counts}
        value={tag}
        onChange={setTag}
        total={pool.length}
      />
      <Button label={t('snippets.add')} icon="plus" onPress={() => setEditing('new')} />

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            description={empty.description}
            action={
              empty.clear ? (
                <Button label={empty.clear.label} variant="outline" onPress={empty.clear.onPress} />
              ) : (
                addButton
              )
            }
          />
        </Panel>
      ) : (
        rows.slice(0, cap.shown).map((snippet) => (
          <FocusTarget key={snippet.id} id={snippet.id}>
            <Panel>
              <View style={styles.head}>
                <View style={s.fill}>
                  <Txt size="base" weight="medium">
                    {snippet.title}
                  </Txt>
                  <View style={styles.chips}>
                    <Chip size="sm" tone="gray">
                      {domain.snippetTag(snippet.tag)}
                    </Chip>
                    <LabelChips recordId={snippet.id} />
                  </View>
                  {/* The card never said what it was filed under, which made the
                      menu action that files it look like it did nothing. */}
                  <FiledUnderLinks applicationIds={snippet.applicationIds} />
                </View>
                {/* Copy is the point of a snippet, so it is the one action on the
                    card. Delete is not: it costs a menu, like every other. */}
                <IconButton
                  icon={isCopied(snippet.id) ? 'check' : 'copy'}
                  label={t('snippets.copyNamed', { name: snippet.title })}
                  active={isCopied(snippet.id)}
                  onPress={() =>
                    copy(snippet.tailored ? stripMarks(snippet.body) : snippet.body, snippet.id)
                  }
                />
                <LabelPicker recordId={snippet.id} name={snippet.title} />
                <IconButton
                  icon="more-horizontal"
                  label={t('common.moreActionsFor', { name: snippet.title })}
                  onPress={() => setMenuFor(snippet)}
                />
              </View>
              {/* A tailored body is drawn with its marks; see `core/marks.ts`. */}
              {snippet.tailored ? (
                <View style={{ marginTop: space[2], maxHeight: 132, overflow: 'hidden' }}>
                  <Marked body={snippet.body} />
                </View>
              ) : (
                <Txt size="sm" tone="secondary" numberOfLines={6} style={{ marginTop: space[2] }}>
                  {snippet.body}
                </Txt>
              )}
            </Panel>
          </FocusTarget>
        ))
      )}
      <ShowMoreRows shown={cap.shown} hidden={cap.hidden} onMore={cap.more} />

      <ApplicationPickerSheet
        open={filingSnippet !== null}
        values={filingSnippet?.applicationIds ?? []}
        onClose={() => setFiling(null)}
        onChange={(ids) => {
          if (filingSnippet) onFileUnder(filingSnippet, ids)
        }}
      />

      <MenuSheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.title}
        description={menuFor ? domain.snippetTag(menuFor.tag) : undefined}
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
                ],
                move: {
                  label: t('snippets.tag'),
                  options: SNIPPET_TAGS,
                  say: domain.snippetTag,
                  current: menuFor.tag,
                  onMove: (next) => onMove(menuFor, next),
                },
                onDelete: () => onDelete(menuFor),
                deleteLabel: t('common.delete'),
              })
            : []
        }
      />

      {editing ? (
        <SnippetEditor
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            if (editing !== 'new') {
              updateSnippet(editing.id, draft)
              toast({ title: t('snippets.toast.saved'), description: draft.title })
            } else {
              addSnippet(draft)
              void report('vault_item_added', { kind: 'snippet' })
              toast({
                title: t('snippets.toast.added'),
                description: t('snippets.toast.addedDescription', {
                  title: draft.title,
                  tag: draft.tag,
                }),
              })
            }
            setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}

function SnippetEditor({
  initial,
  onClose,
  onSave,
}: {
  initial?: Snippet
  onClose: () => void
  onSave: (draft: Omit<Snippet, 'id'>) => void
}) {
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [tag, setTag] = useState<SnippetTag>(initial?.tag ?? 'Cover letter')
  const [applicationIds, setApplicationIds] = useState<readonly string[]>(
    initial?.applicationIds ?? [],
  )
  const [attempted, setAttempted] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  /*
   * Whether anything has been typed that leaving would throw away.
   *
   * Compared against what the form opened with rather than tracked with a flag,
   * so tapping into a field and back out is not "dirty" — the same rule
   * `FileEditor` uses, for the same reason: a prompt that fires when nothing
   * changed is one people learn to dismiss without reading.
   */
  const dirty =
    title !== (initial?.title ?? '') ||
    body !== (initial?.body ?? '') ||
    tag !== (initial?.tag ?? 'Cover letter') ||
    applicationIds.join(',') !== (initial?.applicationIds ?? []).join(',')

  /*
   * The backdrop, the X and Android back all reach `onClose`, so a half-written
   * cover letter went with a stray tap. It was never committed, so the journal
   * has nothing to restore — this is the one thing on this screen that no Undo
   * can bring back, which is why `FileEditor` and web's editor both guard it.
   * This one had been missed.
   */
  const askOrClose = () => {
    if (dirty) setDiscarding(true)
    else onClose()
  }

  const submit = () => {
    setAttempted(true)
    if (!title.trim() || !body.trim()) return
    onSave({ title: title.trim(), body: body.trim(), tag, applicationIds: [...applicationIds] })
  }

  return (
    <Sheet
      open
      onClose={askOrClose}
      size="tall"
      title={initial ? t('snippets.editor.editTitle') : t('snippets.add')}
      description={t('snippets.editor.description')}
      footer={
        <>
          {/* Through `askOrClose`, as the backdrop, the X and Back are: Cancel
              threw away a half-written snippet without asking, and there is no undo. */}
          <Button label={t('common.cancel')} variant="ghost" size="md" onPress={askOrClose} />
          <Button label={t('common.save')} size="md" onPress={submit} />
        </>
      }
    >
      <View style={{ gap: space[3.5], flex: 1, minHeight: 0 }}>
        <TextField
          label={t('common.title')}
          required
          value={title}
          error={attempted && !title.trim() ? t('common.titleRequired') : undefined}
          placeholder={t('snippets.editor.titlePlaceholder')}
          onChangeText={setTitle}
        />
        <FormField label={t('snippets.tag')}>
          <Segment
            label={t('snippets.tag')}
            scroll
            options={SNIPPET_TAGS.map((k) => ({ value: k, label: domain.snippetTag(k) }))}
            value={tag}
            onChange={setTag}
          />
        </FormField>
        <ApplicationField
          values={applicationIds}
          onChange={setApplicationIds}
          hint={t('snippets.editor.applicationHint')}
        />
        <TextField
          label={t('snippets.editor.body')}
          required
          value={body}
          multiline
          error={attempted && !body.trim() ? t('snippets.editor.bodyRequired') : undefined}
          placeholder={t('snippets.editor.bodyPlaceholder')}
          onChangeText={setBody}
          style={{ flex: 1, minHeight: 0 }}
        />
      </View>

      {/* Word for word the one `FileEditor` uses. Two editors on the same phone
          disagreeing about what leaving costs would be worse than either
          wording alone. */}
      <ConfirmSheet
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={t('snippets.discard.title')}
        description={t('snippets.discard.description')}
        confirmLabel={t('snippets.discard.confirm')}
        tone="danger"
        onConfirm={() => {
          setDiscarding(false)
          onClose()
        }}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[1.5],
    marginTop: space[1.5],
  },
})
