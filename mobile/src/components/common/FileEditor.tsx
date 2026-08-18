import { useState } from 'react'
import { pickDocuments } from '@/lib/documents'
import { Txt } from '@/components/ui/Text'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { FormField, TextField } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { displayName } from '@jojo/service/data/seed'
import { FILE_BUCKETS } from '@jojo/service/data/vault'
import type { FileBucket, VaultFile } from '@jojo/service/data/vault'
import { kindOfFile } from '@/lib/files'
import { useApplications } from '@/lib/store-context'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

/**
 * Record a document, or correct one.
 *
 * Shared by the Vault's Files tool and the Profile's Documents panel, because
 * the web app lets you add a document from both and a second copy of this form
 * is how the two ended up disagreeing about which bucket a new file lands in.
 */
export function FileEditor({
  initial,
  defaultBucket = 'Applications',
  onClose,
  onSave,
}: {
  /** Pass a record to correct it; omit to record a new one. */
  initial?: VaultFile
  /** Where a new record lands. The Profile only ever shows one bucket. */
  defaultBucket?: FileBucket
  onClose: () => void
  onSave: (draft: Omit<VaultFile, 'id' | 'savedOn'>) => void
}) {
  const { all: applications, byId } = useApplications()
  const [name, setName] = useState(initial?.name ?? '')
  const [size, setSize] = useState(initial?.size === '—' ? '' : (initial?.size ?? ''))
  const [note, setNote] = useState(initial?.note ?? '')
  const [bucket, setBucket] = useState<FileBucket>(initial?.bucket ?? defaultBucket)
  const [applicationId, setApplicationId] = useState(initial?.applicationId)
  const [appPickerOpen, setAppPickerOpen] = useState(false)
  const [attempted, setAttempted] = useState(false)
  // Set when a real file was picked this sitting, so Save records where the
  // copy went. An edit of an existing record keeps whatever it already had.
  const [uri, setUri] = useState(initial?.uri)
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  /**
   * Pick a file, and fill the form in from it.
   *
   * The fields stay editable afterwards. The name off the filesystem is often
   * not the name anyone wants to read — `Scan_20260812_0001.pdf` — and the
   * record is what the app shows everywhere else.
   */
  const onPick = async () => {
    setPicking(true)
    setPickError(null)
    const result = await pickDocuments(bucket)
    setPicking(false)
    if (!result.ok) {
      if (!result.cancelled) setPickError(result.reason)
      return
    }
    const first = result.documents[0]
    if (!first) return
    setName(first.name)
    setSize(first.size)
    setUri(first.uri)
  }

  const selectedApp = applicationId ? byId.get(applicationId) : undefined

  const submit = () => {
    setAttempted(true)
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      // Read from the extension, so an .odp deck and an .odt document get
      // different icons without the user having to say which is which.
      kind: kindOfFile(name.trim()),
      bucket,
      ...(uri === undefined ? {} : { uri }),
      // An empty string would print as a blank where a size goes; the em dash
      // is what the seed uses for "not known".
      size: size.trim() || '—',
      note: note.trim() || undefined,
      applicationId,
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Edit document' : 'Record a document'}
      description={
        uri
          ? 'Kept on this device, in this app. Nothing is uploaded and nothing reads what is inside it.'
          : 'Choose a file to keep a copy of it, or fill this in by hand to record one you are keeping elsewhere.'
      }
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
          <Button label={initial ? 'Save' : 'Record it'} size="md" onPress={submit} />
        </>
      }
    >
      <View style={{ gap: space[3.5], paddingBottom: space[2] }}>
        {/* First, because it fills in three of the fields below it. Typing them
            stays available for a document kept somewhere else — a paper form,
            a file on a laptop — which is what the old build could only do. */}
        <View style={{ gap: space[2] }}>
          <Button
            label={picking ? 'Choosing…' : uri ? 'Choose a different file' : 'Choose a file'}
            icon="upload"
            variant="outline"
            full
            size="md"
            disabled={picking}
            onPress={onPick}
          />
          {uri ? (
            <Txt size="xs" tone="muted">
              A copy is kept in this app. It goes when the app is uninstalled.
            </Txt>
          ) : null}
          {pickError ? (
            <Txt size="xs" tone="danger">
              {pickError}
            </Txt>
          ) : null}
        </View>

        <TextField
          label="File name"
          required
          mono
          autoCapitalize="none"
          value={name}
          error={attempted && !name.trim() ? 'Name it, including the extension.' : undefined}
          hint="The extension picks the icon — .pdf, .doc, .pptx, .md."
          placeholder="Research-statement-v4.doc"
          onChangeText={setName}
        />
        <TextField
          label="Size"
          value={size}
          placeholder="e.g. 212 KB"
          hint="Optional — left blank it reads as unknown rather than as zero."
          onChangeText={setSize}
        />
        <FormField label="Bucket">
          <Segment
            label="Bucket"
            scroll
            options={FILE_BUCKETS.map((b) => ({ value: b, label: b }))}
            value={bucket}
            onChange={setBucket}
          />
        </FormField>

        <FormField
          label="Related application"
          hint="What the Profile's Documents panel and the graph read to say what is filed where."
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

        <TextField label="Note" value={note} multiline onChangeText={setNote} />
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
