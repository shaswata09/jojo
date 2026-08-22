import { useEffect, useState } from 'react'
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
import { agoLabel } from '@jojo/service/data/timeline'
import type { VaultFile } from '@jojo/service/data/vault'
import { displayName } from '@jojo/service/data/seed'
import { ApplicationPickerSheet } from '@/components/common/ApplicationPickerSheet'
import { FILE_KIND_ICON } from '@/lib/files'
import { useApplications, useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

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
  const c = useColors()
  const { byId } = useApplications()
  const { updateFile } = useVault()
  const { toast } = useToast()
  const [note, setNote] = useState('')
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

  const application = file.applicationId ? byId.get(file.applicationId) : undefined

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
      setOpenError(
        error instanceof Error ? error.message : 'Nothing on this phone offered to open it.',
      )
    }
  }

  const facts: { label: string; value: string }[] = [
    { label: 'Type', value: file.kind },
    { label: 'Size', value: file.size },
    { label: 'Filed', value: agoLabel(file.savedOn, TODAY) },
    { label: 'Bucket', value: file.bucket },
  ]

  /** Same contract as the row menu's: a present-but-undefined key unfiles it. */
  const onFileUnder = (applicationId: string | undefined) => {
    const before = file.applicationId
    updateFile(file.id, { applicationId })
    setFiling(false)
    const now = applicationId ? byId.get(applicationId) : undefined
    toast({
      title: now ? `Filed under ${displayName(now)}` : 'Unfiled',
      description: file.name,
      action: { label: 'Undo', onPress: () => updateFile(file.id, { applicationId: before }) },
    })
  }

  const saveNote = () => {
    const before = file.note
    updateFile(file.id, { note: note.trim() || undefined })
    setEditingNote(false)
    toast({
      title: 'Note saved',
      description: file.name,
      action: { label: 'Undo', onPress: () => updateFile(file.id, { note: before }) },
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      size="tall"
      title={file.name}
      description={`${file.bucket} · filed ${agoLabel(file.savedOn, TODAY)}`}
      footer={
        <>
          <Button
            label="Edit details"
            icon="edit-3"
            variant="outline"
            onPress={() => onEdit(file)}
          />
          <Button label="Done" onPress={onClose} />
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
            title="Recorded, not stored"
            description="This one was filed by hand — a name, a type and a size for a document kept somewhere else. Edit it and choose a file to keep a copy here."
          />
        ) : here === null ? (
          <EmptyState
            icon={FILE_KIND_ICON[file.kind] ?? 'file-text'}
            title="Looking for the copy"
            description="Checking whether the file this record points at is still in the app's storage."
          />
        ) : here ? (
          <EmptyState
            icon={FILE_KIND_ICON[file.kind] ?? 'file-text'}
            title="Kept on this device"
            description="Opens in whatever app on this phone handles the type. Nothing is uploaded, and nothing here reads what is inside it."
            action={<Button label="Open" icon="external-link" onPress={onOpen} />}
          />
        ) : (
          <EmptyState
            icon="alert-triangle"
            title="The copy has gone"
            description="This record points at a file that is no longer in the app's storage — most likely cleared by the system. The record is intact; choose the file again to attach it."
            action={
              <Button label="Choose it again" variant="outline" onPress={() => onEdit(file)} />
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
              Attached to
            </Txt>
            <Button
              label={application ? 'Change' : 'File it under a job'}
              variant="ghost"
              onPress={() => setFiling(true)}
            />
          </View>
          {application ? (
            <Chip tone="gray">{displayName(application)}</Chip>
          ) : (
            <Txt size="sm" tone="muted">
              Not filed under an application. Filing it puts it on that record and lets the graph
              find it from there.
            </Txt>
          )}
        </View>

        <View style={{ gap: space[2] }}>
          <View style={s.row}>
            <Txt size="xs" tone="secondary" weight="medium" style={s.fill}>
              Note
            </Txt>
            {!editingNote ? (
              <Button
                label={file.note ? 'Edit' : 'Add a note'}
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
                label="Note"
                value={note}
                onChangeText={setNote}
                placeholder="What is this document for?"
                multiline
              />
              <View style={[s.row, { justifyContent: 'flex-end' }]}>
                <Button label="Cancel" variant="ghost" onPress={() => setEditingNote(false)} />
                <Button label="Save note" onPress={saveNote} />
              </View>
            </>
          ) : file.note ? (
            <Txt size="sm" tone="secondary">
              {file.note}
            </Txt>
          ) : (
            <View style={s.row}>
              <Feather name="edit-3" size={14} color={c.text3} />
              <Txt size="sm" tone="muted">
                Nothing written down about this one yet.
              </Txt>
            </View>
          )}
        </View>
      </View>
      <ApplicationPickerSheet
        open={filing}
        value={file.applicationId}
        onClose={() => setFiling(false)}
        onChange={onFileUnder}
      />
    </Sheet>
  )
}
