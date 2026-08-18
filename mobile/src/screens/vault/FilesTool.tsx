import { useMemo, useState } from 'react'
import { TODAY } from '@/lib/today'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { FileEditor } from '@/components/common/FileEditor'
import { LabelChips, LabelPicker } from '@/components/common/Labels'
import { buildRecordMenu } from '@/components/common/recordMenu'
import { BucketFilter } from '@/components/ui/BucketFilter'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { MenuSheet } from '@/components/ui/Menu'
import { SearchInput } from '@/components/ui/SearchInput'
import { Divider, Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { displayName } from '@jojo/service/data/seed'
import { agoLabel } from '@jojo/service/data/timeline'
import { FILE_BUCKETS } from '@jojo/service/data/vault'
import type { FileBucket, VaultFile } from '@jojo/service/data/vault'
import { useLabels } from '@/lib/labels-context'
import { vaultEmptyState } from '@/lib/vault-empty'
import { FileViewer } from '@/screens/vault/FileViewer'
import { FILE_KIND_ICON } from '@/lib/files'
import { matchesQuery } from '@/lib/search'
import { useApplications, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

const BUCKET_LABELS = Object.fromEntries(FILE_BUCKETS.map((b) => [b, b])) as Record<
  FileBucket,
  string
>

/**
 * Documents, as records.
 *
 * A record can now have a real file behind it. Choosing one copies it into this
 * app's own storage and the record keeps the path, so the row opens rather than
 * merely describing something. Nothing reads what is inside it: no parsing, no
 * indexing, no upload — the size is computed from the byte count and that is the
 * only thing the contents are used for.
 *
 * Typing a record by hand still works, and is not a lesser path. A document kept
 * on a laptop, or a paper form, is a real thing to track; the viewer tells those
 * two kinds apart rather than treating the second as a failure of the first.
 */
export function FilesTool() {
  const c = useColors()
  const { files, addFile, updateFile, removeFile } = useVault()
  const { byId } = useApplications()
  const { matches, selected, clearSelected } = useLabels()
  const { toast } = useToast()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const [bucket, setBucket] = useState<FileBucket | 'all'>('all')
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<VaultFile | null>(null)
  const [editing, setEditing] = useState<VaultFile | 'new' | null>(null)
  // Opening a document and editing it are two different intentions, and the row
  // used to serve only the second. The tap now reads; the menu still edits.
  const [viewing, setViewing] = useState<VaultFile | null>(null)

  const pool = useMemo(
    () => files.filter((f) => matches(f.id) && matchesQuery(query, f.name, f.note, f.bucket)),
    [files, query, matches],
  )

  const counts = useMemo(() => {
    const map: Partial<Record<FileBucket, number>> = {}
    for (const f of pool) map[f.bucket] = (map[f.bucket] ?? 0) + 1
    return map
  }, [pool])

  const rows = bucket === 'all' ? pool : pool.filter((f) => f.bucket === bucket)

  const onDelete = (f: VaultFile) => {
    const { restore } = removeFile(f.id)
    // The copy stays, and NOTHING reclaims it. Deleting the bytes here would
    // make the Undo below restore a record pointing at nothing, which is the
    // worse of the two outcomes — so removing a document leaks its copy for the
    // life of the install. `forgetDocument` in `lib/documents.ts` is the delete
    // half, and it has no caller: this comment used to claim a sweep on next
    // launch collected them, and there has never been one.
    //
    // Two things any sweep has to handle, both already true: a record restored
    // by Undo must still find its bytes, and `onDuplicate` below copies `uri`
    // verbatim, so two records can point at one file and deleting either would
    // take the other's.
    toast({
      title: 'Document removed',
      description: f.name,
      tone: 'danger',
      action: { label: 'Undo', onPress: restore },
    })
  }

  const onDuplicate = (f: VaultFile) => {
    const { id: _id, savedOn: _savedOn, ...rest } = f
    const copy = addFile({ ...rest, name: copyName(f.name) })
    toast({
      title: 'Document duplicated',
      description: copy.name,
      action: { label: 'Undo', onPress: () => removeFile(copy.id) },
    })
  }

  const onMove = (f: VaultFile, next: FileBucket) => {
    const before = f.bucket
    updateFile(f.id, { bucket: next })
    toast({
      title: `Moved to ${next}`,
      description: f.name,
      action: { label: 'Undo', onPress: () => updateFile(f.id, { bucket: before }) },
    })
  }

  const addButton = (
    <Button label="Record a document" icon="plus" onPress={() => setEditing('new')} />
  )

  const empty = vaultEmptyState({
    total: files.length,
    query,
    filteredByBucket: bucket !== 'all',
    filteredByKeyword: selected.size > 0,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setBucket('all'),
    onClearKeywords: clearSelected,
    copy: {
      icon: 'file-text',
      zero: {
        title: 'No documents yet',
        description:
          'Your CV, statements, talks and admin scans. Names, sizes and types are recorded — nothing reads the file itself.',
      },
      search: (q) => `No document mentions "${q}" in its name, note or bucket.`,
      both: `No document in ${bucket} carries the selected keywords.`,
      bucket: {
        title: `Nothing in ${bucket}`,
        description: `${String(files.length)} documents are filed under the other buckets.`,
        clearLabel: 'Show all buckets',
      },
      keywords: { title: 'No documents carry those keywords' },
    },
  })

  return (
    <>
      <SearchInput
        label="Search documents"
        value={query}
        onChange={setQuery}
        placeholder="Search name, note or bucket"
      />
      <BucketFilter
        label="Filter documents"
        options={FILE_BUCKETS}
        labels={BUCKET_LABELS}
        counts={counts}
        value={bucket}
        onChange={setBucket}
        total={pool.length}
      />
      <Button label="Record a document" icon="plus" onPress={() => setEditing('new')} />

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
          rows.map((f, i) => {
            // The edge is cleared, not followed, when an application is deleted
            // — so a document can name an id whose record has gone.
            const app = f.applicationId ? byId.get(f.applicationId) : undefined
            return (
              <View key={f.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <Feather
                    name={FILE_KIND_ICON[f.kind]}
                    size={17}
                    color={c.text3}
                    style={styles.icon}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${f.name}`}
                    onPress={() => setViewing(f)}
                    style={s.fill}
                  >
                    <Txt size="sm" weight="medium" mono numberOfLines={2}>
                      {f.name}
                    </Txt>
                    <Txt size="xs" tone="muted">
                      {f.size} · saved {agoLabel(f.savedOn, TODAY)}
                    </Txt>
                    {f.note ? (
                      <Txt size="xs" tone="muted" numberOfLines={2}>
                        {f.note}
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
                        {f.bucket}
                      </Chip>
                      <LabelChips recordId={f.id} />
                    </View>
                  </Pressable>
                  <LabelPicker recordId={f.id} name={f.name} />
                  <IconButton
                    icon="more-horizontal"
                    label={`More actions for ${f.name}`}
                    onPress={() => setMenuFor(f)}
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
        title={menuFor?.name}
        description={menuFor ? `${menuFor.bucket} · ${menuFor.size}` : undefined}
        actions={
          menuFor
            ? buildRecordMenu({
                onEdit: () => setEditing(menuFor),
                editLabel: 'Rename and edit note',
                onDuplicate: () => onDuplicate(menuFor),
                move: {
                  label: 'Bucket',
                  options: FILE_BUCKETS,
                  current: menuFor.bucket,
                  onMove: (next) => onMove(menuFor, next),
                },
                onDelete: () => onDelete(menuFor),
                deleteLabel: 'Remove',
              })
            : []
        }
      />

      <FileViewer
        file={viewing}
        onClose={() => setViewing(null)}
        onEdit={(f) => {
          setViewing(null)
          setEditing(f)
        }}
      />

      {editing ? (
        <FileEditor
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            if (editing !== 'new') {
              updateFile(editing.id, draft)
              toast({ title: 'Document updated', description: draft.name })
            } else {
              addFile(draft)
              toast({
                title: 'Document recorded',
                description: `${draft.name} · filed under ${draft.bucket}. The name, size and type are kept — the file itself is not read.`,
              })
            }
            setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}

/** `CV-2026.pdf` → `CV-2026 (copy).pdf`, so the extension survives. */
function copyName(name: string) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name} (copy)`
  return `${name.slice(0, dot)} (copy)${name.slice(dot)}`
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
  icon: { marginTop: 2 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[1.5],
    marginTop: space[1.5],
  },
})
