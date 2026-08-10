import { useState } from 'react'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { FormField, TextField } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { displayName } from '@/data/seed'
import { FILE_BUCKETS } from '@/data/vault'
import type { FileBucket, VaultFile } from '@/data/vault'
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
      // Honest about what this build does. There is no file picker wired up, so
      // the record is typed — and saying so beats implying a file was read.
      description="Nothing is uploaded and no file is read. This records the name, size and type so the rest of the app can point at it."
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
          <Button label={initial ? 'Save' : 'Record it'} size="md" onPress={submit} />
        </>
      }
    >
      <View style={{ gap: space[3.5], paddingBottom: space[2] }}>
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
