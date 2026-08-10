import { useMemo, useState } from 'react'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
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
import { Divider, Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@/data/seed'
import { agoLabel } from '@/data/timeline'
import { LINK_CATEGORIES } from '@/data/vault'
import type { LinkCategory, VaultLink } from '@/data/vault'
import { useLabels } from '@/lib/labels-context'
import { matchesQuery } from '@/lib/search'
import { useApplications, useVault } from '@/lib/store-context'
import { useCopy } from '@/lib/use-copy'
import { displayUrl, hrefOf, normalizeUrl } from '@/lib/urls'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

const CATEGORY_LABELS = Object.fromEntries(LINK_CATEGORIES.map((k) => [k, k])) as Record<
  LinkCategory,
  string
>

/** Postings, department pages, people and guides — anything to come back to. */
export function LinksTool() {
  const { links, addLink, updateLink, removeLink } = useVault()
  const { byId } = useApplications()
  const { matches } = useLabels()
  const { toast } = useToast()
  const { copy } = useCopy()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const [category, setCategory] = useState<LinkCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<VaultLink | 'new' | null>(null)
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
            l.applicationId ? byId.get(l.applicationId)?.org : undefined,
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

  const onDelete = (l: VaultLink) => {
    const { restore } = removeLink(l.id)
    toast({
      title: 'Link removed',
      description: l.title,
      tone: 'danger',
      action: { label: 'Undo', onPress: restore },
    })
  }

  const onDuplicate = (l: VaultLink) => {
    const { id: _id, savedOn: _savedOn, ...rest } = l
    const copyRecord = addLink({ ...rest, title: `${l.title} (copy)` })
    toast({
      title: 'Link duplicated',
      description: copyRecord.title,
      action: { label: 'Undo', onPress: () => removeLink(copyRecord.id) },
    })
  }

  const onMove = (l: VaultLink, next: LinkCategory) => {
    const before = l.category
    updateLink(l.id, { category: next })
    toast({
      title: `Moved to ${next}`,
      description: l.title,
      action: { label: 'Undo', onPress: () => updateLink(l.id, { category: before }) },
    })
  }

  return (
    <>
      <SearchInput
        label="Search links"
        value={query}
        onChange={setQuery}
        placeholder="Search title, URL or note"
      />
      <BucketFilter
        label="Filter links"
        options={LINK_CATEGORIES}
        labels={CATEGORY_LABELS}
        counts={counts}
        value={category}
        onChange={setCategory}
        total={pool.length}
      />
      <Button label="Save a link" icon="plus" onPress={() => setEditing('new')} />

      <Panel padded={false}>
        {rows.length === 0 ? (
          <View style={{ padding: space[4] }}>
            <EmptyState
              icon="link-2"
              title={links.length === 0 ? 'Nothing saved yet' : 'Nothing in this category'}
              description="Postings, department pages, people and guides — anything you want to come back to."
              action={<Button label="Save a link" icon="plus" onPress={() => setEditing('new')} />}
            />
          </View>
        ) : (
          rows.map((l, i) => {
            const app = l.applicationId ? byId.get(l.applicationId) : undefined
            return (
              <View key={l.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${l.title}`}
                    onPress={() => Linking.openURL(hrefOf(l.url))}
                    style={s.fill}
                  >
                    <Txt size="sm" weight="medium" numberOfLines={2}>
                      {l.title}
                    </Txt>
                    <Txt size="xs" tone="muted" mono numberOfLines={1}>
                      {displayUrl(l.url)} · saved {agoLabel(l.savedOn)}
                    </Txt>
                    {l.note ? (
                      <Txt size="xs" tone="muted" numberOfLines={2}>
                        {l.note}
                      </Txt>
                    ) : null}
                    {app ? (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => navigation.navigate('ApplicationDetail', { id: app.id })}
                      >
                        <Txt size="xs" tone="info">
                          {displayName(app)}
                        </Txt>
                      </Pressable>
                    ) : null}
                    <View style={styles.chips}>
                      <Chip size="sm" tone="gray">
                        {l.category}
                      </Chip>
                      <LabelChips recordId={l.id} />
                    </View>
                  </Pressable>
                  <LabelPicker recordId={l.id} name={l.title} />
                  <IconButton
                    icon="more-horizontal"
                    label={`More actions for ${l.title}`}
                    onPress={() => setMenuFor(l)}
                  />
                </View>
              </View>
            )
          })
        )}
      </Panel>

      <MenuSheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.title}
        description={menuFor ? displayUrl(menuFor.url) : undefined}
        actions={
          menuFor
            ? buildRecordMenu({
                onEdit: () => setEditing(menuFor),
                onDuplicate: () => onDuplicate(menuFor),
                extra: [
                  {
                    id: 'open',
                    label: 'Open link',
                    icon: 'external-link',
                    onPress: () => Linking.openURL(hrefOf(menuFor.url)),
                  },
                  {
                    id: 'copy',
                    label: 'Copy URL',
                    icon: 'copy',
                    onPress: async () => {
                      await copy(menuFor.url)
                      toast({ title: 'URL copied', description: displayUrl(menuFor.url) })
                    },
                  },
                ],
                move: {
                  label: 'Category',
                  options: LINK_CATEGORIES,
                  current: menuFor.category,
                  onMove: (next) => onMove(menuFor, next),
                },
                onDelete: () => onDelete(menuFor),
                deleteLabel: 'Remove',
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
              toast({ title: 'Link updated', description: draft.title })
            } else {
              addLink(draft)
              toast({ title: 'Link saved', description: draft.title })
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
  const { all: applications, byId } = useApplications()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [category, setCategory] = useState<LinkCategory>(initial?.category ?? 'Posting')
  const [applicationId, setApplicationId] = useState(initial?.applicationId)
  const [appPickerOpen, setAppPickerOpen] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const selectedApp = applicationId ? byId.get(applicationId) : undefined

  const submit = () => {
    setAttempted(true)
    if (!title.trim() || !url.trim()) return
    onSave({
      title: title.trim(),
      url: normalizeUrl(url),
      note: note.trim() || undefined,
      category,
      applicationId,
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Edit link' : 'Save a link'}
      description="Nothing is fetched — what is kept is the title, the URL and the day you saved it."
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
          <Button label={initial ? 'Save' : 'Save link'} size="md" onPress={submit} />
        </>
      }
    >
      <View style={{ gap: space[3.5], paddingBottom: space[2] }}>
        <TextField
          label="Title"
          required
          value={title}
          error={attempted && !title.trim() ? 'Name it so you can find it again.' : undefined}
          placeholder="e.g. Rice — Statistics posting"
          onChangeText={setTitle}
        />
        <TextField
          label="URL"
          required
          mono
          autoCapitalize="none"
          keyboardType="url"
          value={url}
          error={attempted && !url.trim() ? 'A link with no URL goes nowhere.' : undefined}
          placeholder="jobs.rice.edu/postings/…"
          onChangeText={setUrl}
        />
        <FormField label="Category">
          <Segment
            label="Category"
            scroll
            options={LINK_CATEGORIES.map((k) => ({ value: k, label: k }))}
            value={category}
            onChange={setCategory}
          />
        </FormField>

        {/* The edge that makes a link worth filing. Without it the Vault is a
            bookmark folder; with it, the application's own screen can count
            what is filed under it and a delete knows what to unlink. */}
        <FormField
          label="Related application"
          hint="Links the two, so the application counts this among what is filed under it."
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
          label="Note"
          value={note}
          multiline
          placeholder="Why this is worth coming back to"
          onChangeText={setNote}
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
