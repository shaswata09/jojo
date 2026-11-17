import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { documentExists, openDocument } from '@/lib/documents'
import { TODAY } from '@/lib/today'
import { View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Divider } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import type { VaultFile } from '@jojo/service/data/vault'
import { displayName } from '@jojo/service/data/seed'
import { ApplicationPickerSheet } from '@/components/common/ApplicationPickerSheet'
import { PageViewer } from '@/screens/vault/PageViewer'
import { FILE_KIND_ICON } from '@/lib/files'
import { useApplications, useVault } from '@/lib/store-context'
import { capitalize } from '@/lib/text'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'

/**
 * A document, opened.
 *
 * The web app puts the file in an `<iframe>` and lets the browser's own PDF
 * reader handle it. There is no equivalent here — a React Native view cannot
 * render a PDF without a native viewer this app does not ship — so this hands
 * the file to whatever on the phone can open it and says, in the frame, which
 * of four states the bytes are in: never stored, being looked for, here, or
 * gone. That last pair is the shape the ejection created: `documentExists` was
 * a synchronous getter under `expo-file-system` and is a promise now, so
 * "looking for the copy" is a state this screen had never had to describe.
 *
 * (This paragraph used to say no picker was wired up and no record had bytes
 * behind it. `FileEditor` has picked real documents since the ejection, and the
 * four panels below are about those bytes.)
 *
 * What it does do is the part that was missing. Tapping a file used to drop
 * straight into the edit form — the app had no way to *look at* a document
 * without being asked to change it. This is the read view: what the record is,
 * when it was filed, what it is attached to, and the note in full rather than
 * clipped to one line. Editing is one tap away and clearly a separate act.
 */
export function FileViewer({
  file,
  onClose,
  onEdit,
}: {
  file: VaultFile | null
  onClose: () => void
  onEdit: (file: VaultFile) => void
}) {
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const c = useColors()
  const { byId } = useApplications()
  const { updateFile } = useVault()
  const { toast } = useToast()
  const [note, setNote] = useState('')
  /** The full-screen reader, for a captured posting. */
  const [reading, setReading] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [filing, setFiling] = useState(false)
  // `null` is "not asked yet". `documentExists` used to be a synchronous getter
  // read straight out of the render body; no React Native filesystem library
  // offers a synchronous form, so the answer is now a tick late and this state
  // exists. It is above the `!file` return because hooks have to be.
  const [here, setHere] = useState<boolean | null>(null)

  const uri = file?.uri
  useEffect(() => {
    if (!uri) return
    let live = true
    setHere(null)
    void documentExists(uri).then((exists) => {
      if (live) setHere(exists)
    })
    // Cancelled on unmount and on a change of file, because this sheet is
    // reused for whichever row was tapped and a stale answer would light up
    // the wrong panel for the wrong document.
    return () => {
      live = false
    }
  }, [uri])

  if (!file) return null

  const applications = file.applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)

  /**
   * Hands the file to the OS.
   *
   * An ACTION_VIEW intent on Android, because a `file://` URI cannot be given
   * to another app directly — it needs a content URI, which the filesystem
   * module's own FileProvider mints. On iOS it is the share sheet, which is
   * where Quick Look and "Copy to Files" live.
   */
  const onOpen = async () => {
    if (!file.uri) return
    setOpenError(null)
    try {
      await openDocument(file.uri)
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : t('fileViewer.openFailed'))
    }
  }

  const facts: { label: string; value: string }[] = [
    { label: t('fileViewer.facts.type'), value: file.kind },
    { label: t('fileViewer.facts.size'), value: file.size },
    { label: t('fileViewer.facts.filed'), value: domain.ago(file.savedOn, TODAY) },
    { label: t('fileViewer.facts.bucket'), value: file.bucket },
  ]

  /**
   * Same contract as the row menu's: the whole list, every time.
   *
   * `FILED_UNDER` is `fromCardinality: 'many'`, so an empty array is what
   * unfiles it — and the sheet is not dismissed here, because it stays up
   * across taps and closes on Done.
   */
  const onFileUnder = (applicationIds: string[]) => {
    const before = file.applicationIds
    updateFile(file.id, { applicationIds })
    const chosen = applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
    toast({
      title: capitalize(domain.filedUnder(chosen.map(displayName))),
      description: file.name,
      action: {
        label: t('common.undo'),
        onPress: () => updateFile(file.id, { applicationIds: before }),
      },
    })
  }

  const saveNote = () => {
    const before = file.note
    updateFile(file.id, { note: note.trim() || undefined })
    setEditingNote(false)
    toast({
      title: t('fileViewer.toast.noteSaved'),
      description: file.name,
      action: { label: t('common.undo'), onPress: () => updateFile(file.id, { note: before }) },
    })
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        size="tall"
        // Taller than the screen with a field or two open; scrolls rather
        // than clipping the last field and its Save under the footer.
        scroll
        title={file.name}
        description={t('fileViewer.description', {
          bucket: file.bucket,
          ago: domain.ago(file.savedOn, TODAY),
        })}
        footer={
          <>
            <Button
              label={t('fileViewer.editDetails')}
              icon="edit-3"
              variant="outline"
              onPress={() => onEdit(file)}
            />
            <Button label={t('common.done')} onPress={onClose} />
          </>
        }
      >
        <View style={{ gap: space[4] }}>
          {/* Where the document would be. Named for what is missing rather than
            dressed up as a failed load — nothing was attempted, so "could not
            display" would be a lie about a request that never happened. */}
          {/* Four states now, and they are genuinely different. A record that
            never had a copy is the typed kind, which is a legitimate way to
            file something kept elsewhere — and it is checked FIRST, because it
            is known without asking the filesystem and must not flicker through
            the waiting state on its way to being drawn.

            The other three need an answer from disk: still looking, found, and
            gone. "Still looking" is normally one frame, and it holds the space
            with the same icon the found state uses rather than rendering
            nothing, because a panel that appears a frame late is a layout that
            resettles under the reader's thumb. */}
          {!file.uri ? (
            <EmptyState
              icon={FILE_KIND_ICON[file.kind] ?? 'file-text'}
              title={t('fileViewer.typed.title')}
              description={t('fileViewer.typed.description')}
            />
          ) : here === null ? (
            <EmptyState
              icon={FILE_KIND_ICON[file.kind] ?? 'file-text'}
              title={t('fileViewer.checking.title')}
              description={t('fileViewer.checking.description')}
            />
          ) : here ? (
            /* A captured posting is the one kind this app can read itself, so it
             is the one kind that does not leave. Everything else is handed to
             whatever handles the type, because a React Native view cannot
             render a PDF without a native viewer this app does not ship — but a
             saved page is markup, and the WebView is already here. */
            file.kind === 'page' ? (
              <EmptyState
                icon="globe"
                title={t('fileViewer.kept.title')}
                description={t('fileViewer.kept.pageDescription')}
                action={
                  <Button
                    label={t('fileViewer.kept.read')}
                    icon="book-open"
                    onPress={() => setReading(true)}
                  />
                }
              />
            ) : (
              <EmptyState
                icon={FILE_KIND_ICON[file.kind] ?? 'file-text'}
                title={t('fileViewer.kept.title')}
                description={t('fileViewer.kept.fileDescription')}
                action={
                  <Button label={t('fileViewer.kept.open')} icon="external-link" onPress={onOpen} />
                }
              />
            )
          ) : (
            <EmptyState
              icon="alert-triangle"
              title={t('fileViewer.gone.title')}
              description={t('fileViewer.gone.description')}
              action={
                <Button
                  label={t('fileViewer.gone.choose')}
                  variant="outline"
                  onPress={() => onEdit(file)}
                />
              }
            />
          )}

          {openError ? (
            <Txt size="xs" tone="danger">
              {openError}
            </Txt>
          ) : null}

          <View>
            {facts.map((f, i) => (
              <View key={f.label}>
                {i > 0 ? <Divider /> : null}
                <View style={[s.row, { paddingVertical: space[2.5] }]}>
                  <Txt size="sm" tone="secondary" style={s.fill}>
                    {f.label}
                  </Txt>
                  <Txt size="sm">{f.value}</Txt>
                </View>
              </View>
            ))}
          </View>

          {/* Always shown, including when nothing is filed. Rendering the row
            only when there IS an application meant an unfiled document gave no
            sign it could be filed at all — the capability existed and the
            screen kept it a secret. */}
          <View style={{ gap: space[2] }}>
            <View style={s.row}>
              <Txt size="xs" tone="secondary" weight="medium" style={s.fill}>
                {t('fileViewer.attachedTo')}
              </Txt>
              <Button
                label={
                  applications.length > 0 ? t('fileViewer.change') : t('fileViewer.fileUnderJob')
                }
                variant="ghost"
                onPress={() => setFiling(true)}
              />
            </View>
            {applications.length > 0 ? (
              // A row of chips rather than one: a CV goes to every job you send
              // it to, and the panel that names only the first would be wrong
              // about the other four.
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                {applications.map((a) => (
                  <Chip key={a.id} tone="gray">
                    {displayName(a)}
                  </Chip>
                ))}
              </View>
            ) : (
              <Txt size="sm" tone="muted">
                {t('fileViewer.notFiled')}
              </Txt>
            )}
          </View>

          <View style={{ gap: space[2] }}>
            <View style={s.row}>
              <Txt size="xs" tone="secondary" weight="medium" style={s.fill}>
                {t('common.note')}
              </Txt>
              {!editingNote ? (
                <Button
                  label={file.note ? t('common.edit') : t('fileViewer.addNote')}
                  variant="ghost"
                  onPress={() => {
                    setNote(file.note ?? '')
                    setEditingNote(true)
                  }}
                />
              ) : null}
            </View>

            {editingNote ? (
              <>
                <TextField
                  label={t('common.note')}
                  value={note}
                  onChangeText={setNote}
                  placeholder={t('fileViewer.notePlaceholder')}
                  multiline
                />
                <View style={[s.row, { justifyContent: 'flex-end' }]}>
                  <Button
                    label={t('common.cancel')}
                    variant="ghost"
                    onPress={() => setEditingNote(false)}
                  />
                  <Button label={t('fileViewer.saveNote')} onPress={saveNote} />
                </View>
              </>
            ) : file.note ? (
              <Txt size="sm" tone="secondary">
                {file.note}
              </Txt>
            ) : (
              <View style={s.row}>
                <Feather name="edit-3" size={14} color={c.text3} />
                <Txt size="sm" tone="muted" style={s.fill}>
                  {t('fileViewer.noNote')}
                </Txt>
              </View>
            )}
          </View>
        </View>
        <ApplicationPickerSheet
          open={filing}
          values={file.applicationIds}
          onClose={() => setFiling(false)}
          onChange={onFileUnder}
        />
      </Sheet>
      {/* Outside the Sheet rather than inside it: a full-screen Modal nested in
          another Modal is a stacking fight on Android, and the reader wants the
          whole screen anyway. */}
      {reading ? <PageViewer file={file} onClose={() => setReading(false)} /> : null}
    </>
  )
}
