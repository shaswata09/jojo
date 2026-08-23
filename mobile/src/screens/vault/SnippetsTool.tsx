import { useMemo, useState } from 'react'
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
import { Sheet } from '@/components/ui/Sheet'
import { Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { filedUnderLabel } from '@jojo/service/data/seed'
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
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

const TAG_LABELS = Object.fromEntries(SNIPPET_TAGS.map((t) => [t, t])) as Record<SnippetTag, string>

/**
 * The answers you retype on every form.
 *
 * Copying is the whole point, so it is the one action promoted out of the
 * overflow onto the card. Everything else — edit, duplicate, retag, delete —
 * lives behind the ⋯ in the order every list in the app uses.
 */
export function SnippetsTool({ focus }: { focus?: string }) {
  // Only the arrival highlight needs the palette here.
  const c = useColors()
  const { snippets, addSnippet, updateSnippet, removeSnippet } = useVault()
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

  const onDelete = (snippet: Snippet) => {
    const { restore } = removeSnippet(snippet.id)
    toast({
      title: 'Snippet deleted',
      description: snippet.title,
      tone: 'danger',
      action: { label: 'Undo', onPress: restore },
    })
  }

  const onDuplicate = (snippet: Snippet) => {
    const { id: _id, ...rest } = snippet
    const made = addSnippet({ ...rest, title: `${snippet.title} (copy)` })
    toast({
      title: 'Snippet duplicated',
      description: made.title,
      action: { label: 'Undo', onPress: () => removeSnippet(made.id) },
    })
  }

  /** Sets the whole list — `FILED_UNDER` is many, so unticking the last unfiles it. */
  const onFileUnder = (record: Snippet, applicationIds: string[]) => {
    const before = record.applicationIds
    updateSnippet(record.id, { applicationIds })
    const chosen = applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
    toast({
      title: capitalize(filedUnderLabel(chosen)),
      description: record.title,
      action: {
        label: 'Undo',
        onPress: () => updateSnippet(record.id, { applicationIds: before }),
      },
    })
  }

  const onMove = (snippet: Snippet, next: SnippetTag) => {
    const before = snippet.tag
    updateSnippet(snippet.id, { tag: next })
    toast({
      title: `Filed under ${next}`,
      description: snippet.title,
      action: { label: 'Undo', onPress: () => updateSnippet(snippet.id, { tag: before }) },
    })
  }

  const addButton = <Button label="New snippet" icon="plus" onPress={() => setEditing('new')} />

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
        title: 'No snippets yet',
        description:
          'The answers you retype on every form — a short bio, a teaching paragraph, the follow-up email you always send.',
      },
      search: (q) => `No snippet mentions "${q}" in its name, text or kind.`,
      both: `No ${tag} snippet carries the selected keywords.`,
      bucket: {
        title: `No ${tag} snippets`,
        description: `${String(snippets.length)} snippets are filed under the other kinds.`,
        clearLabel: 'Show all kinds',
      },
      keywords: { title: 'No snippets carry those keywords' },
    },
  })

  return (
    <>
      <SearchInput
        label="Search snippets"
        value={query}
        onChange={setQuery}
        placeholder="Search title or body"
      />
      <BucketFilter
        label="Filter snippets"
        options={SNIPPET_TAGS}
        labels={TAG_LABELS}
        counts={counts}
        value={tag}
        onChange={setTag}
        total={pool.length}
      />
      <Button label="New snippet" icon="plus" onPress={() => setEditing('new')} />

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
        rows.map((snippet) => (
          <Panel
            key={snippet.id}
            style={focus === snippet.id ? { borderColor: c.accentBorder } : undefined}
          >
            <View style={styles.head}>
              <View style={s.fill}>
                <Txt size="base" weight="medium">
                  {snippet.title}
                </Txt>
                <View style={styles.chips}>
                  <Chip size="sm" tone="gray">
                    {snippet.tag}
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
                label={`Copy ${snippet.title}`}
                active={isCopied(snippet.id)}
                onPress={() => copy(snippet.body, snippet.id)}
              />
              <LabelPicker recordId={snippet.id} name={snippet.title} />
              <IconButton
                icon="more-horizontal"
                label={`More actions for ${snippet.title}`}
                onPress={() => setMenuFor(snippet)}
              />
            </View>
            <Txt size="sm" tone="secondary" numberOfLines={6} style={{ marginTop: space[2] }}>
              {snippet.body}
            </Txt>
          </Panel>
        ))
      )}

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
        description={menuFor?.tag}
        actions={
          menuFor
            ? buildRecordMenu({
                onEdit: () => setEditing(menuFor),
                onDuplicate: () => onDuplicate(menuFor),
                extra: [
                  {
                    id: 'file-under',
                    label:
                      menuFor.applicationIds.length > 0
                        ? 'Change applications'
                        : 'File under an application',
                    icon: 'briefcase',
                    onPress: () => setFiling(menuFor.id),
                  },
                ],
                move: {
                  label: 'Tag',
                  options: SNIPPET_TAGS,
                  current: menuFor.tag,
                  onMove: (next) => onMove(menuFor, next),
                },
                onDelete: () => onDelete(menuFor),
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
              toast({ title: 'Snippet saved', description: draft.title })
            } else {
              addSnippet(draft)
              toast({
                title: 'Snippet added',
                description: `${draft.title} · filed under ${draft.tag}`,
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
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [tag, setTag] = useState<SnippetTag>(initial?.tag ?? 'Cover letter')
  const [applicationIds, setApplicationIds] = useState<readonly string[]>(
    initial?.applicationIds ?? [],
  )
  const [attempted, setAttempted] = useState(false)

  const submit = () => {
    setAttempted(true)
    if (!title.trim() || !body.trim()) return
    onSave({ title: title.trim(), body: body.trim(), tag, applicationIds: [...applicationIds] })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      size="tall"
      title={initial ? 'Edit snippet' : 'New snippet'}
      description="Anything in [BRACKETS] stays a blank when the draft sheet loads this, so a person's name is never filled in for you."
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
          <Button label="Save" size="md" onPress={submit} />
        </>
      }
    >
      <View style={{ gap: space[3.5], flex: 1, minHeight: 0 }}>
        <TextField
          label="Title"
          required
          value={title}
          error={attempted && !title.trim() ? 'Name it so you can find it again.' : undefined}
          placeholder="e.g. Follow-up after no response"
          onChangeText={setTitle}
        />
        <FormField label="Tag">
          <Segment
            label="Tag"
            scroll
            options={SNIPPET_TAGS.map((t) => ({ value: t, label: t }))}
            value={tag}
            onChange={setTag}
          />
        </FormField>
        <ApplicationField
          values={applicationIds}
          onChange={setApplicationIds}
          hint="Optional. A snippet written for particular employers can say which."
        />
        <TextField
          label="Body"
          required
          value={body}
          multiline
          error={
            attempted && !body.trim() ? 'A snippet with no text has nothing to paste.' : undefined
          }
          placeholder="Dear [NAME], …"
          onChangeText={setBody}
          style={{ flex: 1, minHeight: 0 }}
        />
      </View>
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
