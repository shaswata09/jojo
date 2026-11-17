import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18next } from '@/i18n/i18n'
import { TODAY } from '@/lib/today'
import { trashDocument } from '@/lib/documents'
import { Pressable, StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { ApplicationPickerSheet } from '@/components/common/ApplicationPickerSheet'
import { FileEditor } from '@/components/common/FileEditor'
import { FiledUnderLinks } from '@/components/common/FiledUnderLinks'
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
import { FILE_BUCKETS } from '@jojo/service/data/vault'
import type { FileBucket, VaultFile } from '@jojo/service/data/vault'
import { useLabels } from '@/lib/labels-context'
import { vaultEmptyState } from '@/lib/vault-empty'
import { FileViewer } from '@/screens/vault/FileViewer'
import { FILE_KIND_ICON } from '@/lib/files'
import { matchesQuery } from '@/lib/search'
import { capitalize } from '@/lib/text'
import { useApplications, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { TourTarget } from '@/components/tour/TourTarget'
import { report } from '@/lib/analytics'
import { useDomain } from '@/i18n/domain'
import { FocusTarget } from '@/components/ui/FocusTarget'

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
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const c = useColors()
  const { files, addFile, updateFile, removeFile } = useVault()
  const { byId } = useApplications()
  const { matches, selected, clearSelected } = useLabels()
  const { toast } = useToast()

  const [bucket, setBucket] = useState<FileBucket | 'all'>('all')
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<VaultFile | null>(null)
  const [editing, setEditing] = useState<VaultFile | 'new' | null>(null)
  // Opening a document and editing it are two different intentions, and the row
  // used to serve only the second. The tap now reads; the menu still edits.
  const [viewing, setViewing] = useState<VaultFile | null>(null)
  // The row's own way to file a document under a job. It used to be reachable
  // only by opening the edit sheet and finding the field two thirds of the way
  // down it, which is a capability nobody looking for it would find.
  //
  // An ID rather than the record, unlike the two above: the picker is a
  // multi-select that stays open across taps, so it has to be looking at what
  // the document says NOW. Holding the record froze the ticks at whatever they
  // were when the sheet opened, and the second tap undid the first.
  const [filing, setFiling] = useState<string | null>(null)
  const filingFile = files.find((f) => f.id === filing) ?? null

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
    /*
     * The bytes go with the record, and come back with the Undo.
     *
     * This used to delete the record and leave the copy on the device for the
     * life of the install — deliberately, because deleting it here would have
     * made the Undo restore a record pointing at nothing, and a row that looks
     * intact with its document silently gone is the worse of the two. The web
     * app had already solved that at its own layer (`blobs.remove`, then
     * `blobs.restore` on Undo); `trashDocument` is the phone's version.
     *
     * `shared` is the part only this screen can answer: `onDuplicate` below
     * copies `uri` verbatim, so two records can name one file, and trashing it
     * under one of them would take the other's document too.
     */
    const shared = files.some((other) => other.id !== f.id && other.uri === f.uri)
    const { restore } = removeFile(f.id)
    // The promise, not the function it resolves to: an Undo pressed before the
    // move finished used to find nothing to call. Every OTHER Undo — Undo last
    // in the audit log, the assistant's — reaches the bytes through
    // `reconcileTrashedDocuments`, which watches the records (health-1).
    const trashing = trashDocument(f.uri, shared)

    toast({
      title: t('files.toast.removed'),
      description: f.name,
      tone: 'danger',
      action: {
        label: t('common.undo'),
        onPress: () => {
          restore()
          void trashing.then((restoreBytes) => restoreBytes())
        },
      },
    })
  }

  const onDuplicate = (f: VaultFile) => {
    const { id: _id, savedOn: _savedOn, ...rest } = f
    const copy = addFile({ ...rest, name: copyName(f.name) })
    toast({
      title: t('files.toast.duplicated'),
      description: copy.name,
      action: { label: t('common.undo'), onPress: () => removeFile(copy.id) },
    })
  }

  /**
   * Files the document under any number of jobs, or under none.
   *
   * `applicationIds` is always PRESENT in the patch, including when empty —
   * that is what tells the update to set the field rather than leave it alone,
   * and `asNull` turns a present-and-undefined into the null the tool reads as
   * an unfile. The edge is `fromCardinality: 'many'`, so this SETS the whole
   * list rather than adding to it: what the sheet shows is what the record
   * ends up with, which is also what makes unticking the last one an unfile.
   *
   * The sheet is left open by its own rows and closed by Done, so this does
   * not dismiss it — see `ApplicationPickerSheet`.
   */
  const onFileUnder = (f: VaultFile, applicationIds: string[]) => {
    const before = f.applicationIds
    updateFile(f.id, { applicationIds })
    const chosen = applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
    toast({
      title: capitalize(domain.filedUnder(chosen.map(displayName))),
      description: f.name,
      action: {
        label: t('common.undo'),
        onPress: () => updateFile(f.id, { applicationIds: before }),
      },
    })
  }

  const onMove = (f: VaultFile, next: FileBucket) => {
    const before = f.bucket
    updateFile(f.id, { bucket: next })
    toast({
      title: t('common.movedTo', { name: next }),
      description: f.name,
      action: { label: t('common.undo'), onPress: () => updateFile(f.id, { bucket: before }) },
    })
  }

  const addButton = <Button label={t('files.add')} icon="plus" onPress={() => setEditing('new')} />

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
        title: t('files.empty.zeroTitle'),
        description: t('files.empty.zeroDescription'),
      },
      search: (q) => t('files.empty.search', { query: q }),
      both: t('files.empty.both', { bucket }),
      bucket: {
        title: t('files.empty.bucketTitle', { bucket }),
        description: t('files.empty.bucketDescription', { count: files.length }),
        clearLabel: t('files.empty.showAll'),
      },
      keywords: { title: t('files.empty.keywordsTitle') },
    },
  })

  return (
    <>
      <SearchInput
        label={t('files.search.label')}
        value={query}
        onChange={setQuery}
        placeholder={t('files.search.placeholder')}
      />
      <BucketFilter
        label={t('files.filterLabel')}
        options={FILE_BUCKETS}
        labels={BUCKET_LABELS}
        counts={counts}
        value={bucket}
        onChange={setBucket}
        total={pool.length}
      />
      <Button label={t('files.add')} icon="plus" onPress={() => setEditing('new')} />

      {/* Marked for the guided tour, which points at the list. */}
      <TourTarget id="files">
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
              return (
                <FocusTarget key={f.id} id={f.id}>
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
                      accessibilityLabel={t('common.openNamed', { name: f.name })}
                      onPress={() => setViewing(f)}
                      style={s.fill}
                    >
                      <Txt size="sm" weight="medium" mono numberOfLines={2}>
                        {f.name}
                      </Txt>
                      <Txt size="xs" tone="muted">
                        {f.size} · {t('common.savedAgo', { ago: domain.ago(f.savedOn, TODAY) })}
                      </Txt>
                      {f.note ? (
                        <Txt size="xs" tone="muted" numberOfLines={2}>
                          {f.note}
                        </Txt>
                      ) : null}
                      <FiledUnderLinks applicationIds={f.applicationIds} />
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
                      label={t('common.moreActionsFor', { name: f.name })}
                      onPress={() => setMenuFor(f)}
                    />
                  </View>
                </FocusTarget>
              )
            })
          )}
        </Panel>
      </TourTarget>

      <MenuSheet
        open={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.name}
        description={menuFor ? `${menuFor.bucket} · ${menuFor.size}` : undefined}
        actions={
          menuFor
            ? buildRecordMenu({
                onEdit: () => setEditing(menuFor),
                // Named for the sheet it opens rather than for two of the five
                // fields in it. It said 'Rename and edit note', which was true
                // when those were the only two — the bucket and the related
                // application are edited in there too, and a menu that does not
                // mention the application is a menu nobody finds it in.
                editLabel: t('files.editLabel'),
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
                  label: t('files.bucket'),
                  options: FILE_BUCKETS,
                  current: menuFor.bucket,
                  onMove: (next) => onMove(menuFor, next),
                },
                onDelete: () => onDelete(menuFor),
                deleteLabel: t('common.remove'),
              })
            : []
        }
      />

      <ApplicationPickerSheet
        open={filingFile !== null}
        values={filingFile?.applicationIds ?? []}
        onClose={() => setFiling(null)}
        onChange={(ids) => {
          if (filingFile) onFileUnder(filingFile, ids)
        }}
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
              toast({ title: t('files.toast.updated'), description: draft.name })
            } else {
              addFile(draft)
              void report('vault_item_added', { kind: 'file' })
              toast({
                title: t('files.toast.recorded'),
                description: t('files.toast.recordedDescription', {
                  name: draft.name,
                  bucket: draft.bucket,
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

/** `CV-2026.pdf` → `CV-2026 (copy).pdf`, so the extension survives. */
function copyName(name: string) {
  const copyOf = (base: string) => i18next.t('vault:common.copyOf', { name: base })
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return copyOf(name)
  return `${copyOf(name.slice(0, dot))}${name.slice(dot)}`
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
