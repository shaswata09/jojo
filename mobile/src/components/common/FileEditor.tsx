import { useState } from 'react'
import { ApplicationField } from '@/components/common/ApplicationPickerSheet'
import { pickDocuments } from '@/lib/documents'
import { Txt } from '@/components/ui/Text'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { FormField, TextField } from '@/components/ui/Field'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { FILE_BUCKETS } from '@jojo/service/data/vault'
import type { FileBucket, VaultFile } from '@jojo/service/data/vault'
import { kindOfFile } from '@/lib/files'
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
  const [name, setName] = useState(initial?.name ?? '')
  const [size, setSize] = useState(initial?.size === '—' ? '' : (initial?.size ?? ''))
  const [note, setNote] = useState(initial?.note ?? '')
  const [bucket, setBucket] = useState<FileBucket>(initial?.bucket ?? defaultBucket)
  const [applicationIds, setApplicationIds] = useState<readonly string[]>(
    initial?.applicationIds ?? [],
  )
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
    // The previous copy is orphaned, not deleted, and that is the same open
    // end as removing a document: an Undo of this edit has to find the old
    // bytes still there. `forgetDocument` has a caller now — Settings' three
    // wipes, through `forgetDocuments` — but it is the caller with no Undo on
    // it, which is exactly why it is not this one. See `FilesTool`'s `onDelete`
    // for the two constraints a sweep has to satisfy.
    setUri(first.uri)
  }

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
      applicationIds: [...applicationIds],
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

        <ApplicationField
          values={applicationIds}
          onChange={setApplicationIds}
          hint="What the Profile's Documents panel and the graph read to say what is filed where. As many jobs as the document went to."
        />

        <TextField label="Note" value={note} multiline onChangeText={setNote} />
      </View>
    </Sheet>
  )
}
