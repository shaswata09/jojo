import { useState } from 'react'
import { documentExists, openDocument } from '@/lib/documents'
import { TODAY } from '@/lib/today'
import { View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { TextField } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Divider } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { agoLabel } from '@/data/timeline'
import type { VaultFile } from '@/data/vault'
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
 * reader handle it. There is no equivalent here and pretending otherwise would
 * be the exact failure this codebase keeps refusing: no picker is wired up, so
 * no record has bytes behind it, so a viewer frame would be a rectangle drawn
 * around nothing. It says that instead, once, in the place you would look.
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

  if (!file) return null

  const application = file.applicationId ? byId.get(file.applicationId) : undefined
  const here = documentExists(file.uri)

  /**
   * Hands the file to the OS.
   *
   * `IntentLauncher` on Android because a `file://` URI cannot be given to
   * another app directly — it needs a content URI, which `getContentUriAsync`
   * mints. On iOS `Sharing` is the sheet that offers Quick Look among the rest.
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
        {/* Three states, and they are genuinely different. A record with a copy
            opens it; a record whose copy has gone says so rather than failing
            on tap; a record that never had one is the typed kind, which is a
            legitimate way to file something kept elsewhere. */}
        {here ? (
          <EmptyState
            icon={FILE_KIND_ICON[file.kind] ?? 'file-text'}
            title="Kept on this device"
            description="Opens in whatever app on this phone handles the type. Nothing is uploaded, and nothing here reads what is inside it."
            action={<Button label="Open" icon="external-link" onPress={onOpen} />}
          />
        ) : file.uri ? (
          <EmptyState
            icon="alert-triangle"
            title="The copy has gone"
            description="This record points at a file that is no longer in the app's storage — most likely cleared by the system. The record is intact; choose the file again to attach it."
            action={
              <Button label="Choose it again" variant="outline" onPress={() => onEdit(file)} />
            }
          />
        ) : (
          <EmptyState
            icon={FILE_KIND_ICON[file.kind] ?? 'file-text'}
            title="Recorded, not stored"
            description="This one was filed by hand — a name, a type and a size for a document kept somewhere else. Edit it and choose a file to keep a copy here."
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

        {application ? (
          <View style={{ gap: space[2] }}>
            <Txt size="xs" tone="secondary" weight="medium">
              Attached to
            </Txt>
            <Chip tone="gray">{application.org}</Chip>
          </View>
        ) : null}

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
    </Sheet>
  )
}
