import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { LabelChips, LabelPicker } from '@/components/common/Labels'
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
import { displayName } from '@jojo/service/data/seed'
import { SNIPPET_TAGS } from '@jojo/service/data/vault'
import type { Snippet, SnippetTag } from '@jojo/service/data/vault'
import { useLabels } from '@/lib/labels-context'
import { vaultEmptyState } from '@/lib/vault-empty'
import { matchesQuery } from '@/lib/search'
import { useApplications, useVault } from '@/lib/store-context'
import { useCopy } from '@/lib/use-copy'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

const TAG_LABELS = Object.fromEntries(SNIPPET_TAGS.map((t) => [t, t])) as Record<SnippetTag, string>

/**
 * The answers you retype on every form.
 *
 * Copying is the whole point, so it is the one action promoted out of the
 * overflow onto the card. Everything else — edit, duplicate, retag, delete —
 * lives behind the ⋯ in the order every list in the app uses.
 */
export function SnippetsTool() {
  const { snippets, addSnippet, updateSnippet, removeSnippet } = useVault()
  const { matches, selected, clearSelected } = useLabels()
  const { toast } = useToast()
  const { copy, isCopied } = useCopy()

  const [tag, setTag] = useState<SnippetTag | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Snippet | 'new' | null>(null)
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
          <Panel key={snippet.id}>
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
  const { all: applications, byId } = useApplications()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [tag, setTag] = useState<SnippetTag>(initial?.tag ?? 'Cover letter')
  const [applicationId, setApplicationId] = useState(initial?.applicationId)
  const [appPickerOpen, setAppPickerOpen] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const selectedApp = applicationId ? byId.get(applicationId) : undefined

  const submit = () => {
    setAttempted(true)
    if (!title.trim() || !body.trim()) return
    onSave({ title: title.trim(), body: body.trim(), tag, applicationId })
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
        <FormField
          label="Related application"
          hint="Optional. A snippet written for one employer can say so."
        >
          <View style={s.row}>
            <Button
              label={selectedApp ? displayName(selectedApp) : 'Not linked'}
              variant="outline"
              size="md"
              style={s.fill}
              onPress={() => setAppPickerOpen(true)}
            />
            {applicationId ? (
              <Button
                label="Clear"
                variant="ghost"
                size="md"
                onPress={() => setApplicationId(undefined)}
              />
            ) : null}
          </View>
        </FormField>
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

      <MenuSheet
        open={appPickerOpen}
        onClose={() => setAppPickerOpen(false)}
        title="Related application"
        actions={
          applications.length === 0
            ? [{ id: 'none', label: 'No applications yet', disabled: true, onPress: () => {} }]
            : applications.map((a) => ({
                id: a.id,
                label: displayName(a),
                hint: a.roleTag,
                checked: a.id === applicationId,
                onPress: () => setApplicationId(a.id),
              }))
        }
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
