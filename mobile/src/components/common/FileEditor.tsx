import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApplicationField } from '@/components/common/ApplicationPickerSheet'
import { pickDocuments } from '@/lib/documents'
import { Txt } from '@/components/ui/Text'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
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
  const { t } = useTranslation(['components', 'common'])
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
  const [discarding, setDiscarding] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)

  /**
   * Whether anything has been typed that leaving would throw away.
   *
   * Compared against what the form opened with rather than tracked with a
   * flag, so tapping into a field and back out is not "dirty". A new record is
   * dirty as soon as any field has something in it.
   */
  const dirty =
    name !== (initial?.name ?? '') ||
    size !== (initial?.size === '—' ? '' : (initial?.size ?? '')) ||
    note !== (initial?.note ?? '') ||
    bucket !== (initial?.bucket ?? defaultBucket) ||
    uri !== initial?.uri

  /*
   * The backdrop, the X and Android back all reach `onClose` — so a half-typed
   * record went with a stray tap, with no prompt and no undo. It was never
   * committed, so the journal has nothing to restore: this is the one thing
   * here that no undo can bring back, which is the same reason web guards it.
   */
  const askOrClose = () => {
    if (dirty) setDiscarding(true)
    else onClose()
  }

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
      onClose={askOrClose}
      title={initial ? t('fileEditor.editTitle') : t('fileEditor.newTitle')}
      description={uri ? t('fileEditor.keptHere') : t('fileEditor.chooseOrType')}
      footer={
        <>
          <Button
            label={t('common:actions.cancel')}
            variant="ghost"
            size="md"
            onPress={askOrClose}
          />
          <Button
            label={initial ? t('common:actions.save') : t('fileEditor.record')}
            size="md"
            onPress={submit}
          />
        </>
      }
    >
      <View style={{ gap: space[3.5], paddingBottom: space[2] }}>
        {/* First, because it fills in three of the fields below it. Typing them
            stays available for a document kept somewhere else — a paper form,
            a file on a laptop — which is what the old build could only do. */}
        <View style={{ gap: space[2] }}>
          <Button
            label={
              picking
                ? t('fileEditor.choosing')
                : uri
                  ? t('fileEditor.chooseDifferent')
                  : t('fileEditor.choose')
            }
            icon="upload"
            variant="outline"
            full
            size="md"
            disabled={picking}
            onPress={onPick}
          />
          {uri ? (
            <Txt size="xs" tone="muted">
              {t('fileEditor.copyKept')}
            </Txt>
          ) : null}
          {pickError ? (
            <Txt size="xs" tone="danger">
              {pickError}
            </Txt>
          ) : null}
        </View>

        <TextField
          label={t('fileEditor.fileName')}
          required
          mono
          autoCapitalize="none"
          value={name}
          error={attempted && !name.trim() ? t('fileEditor.nameRequired') : undefined}
          hint={t('fileEditor.nameHint')}
          placeholder="Research-statement-v4.doc"
          onChangeText={setName}
        />
        <TextField
          label={t('fileEditor.size')}
          value={size}
          placeholder={t('fileEditor.sizePlaceholder')}
          hint={t('fileEditor.sizeHint')}
          onChangeText={setSize}
        />
        <FormField label={t('fileEditor.bucket')}>
          <Segment
            label={t('fileEditor.bucket')}
            scroll
            options={FILE_BUCKETS.map((b) => ({ value: b, label: b }))}
            value={bucket}
            onChange={setBucket}
          />
        </FormField>

        <ApplicationField
          values={applicationIds}
          onChange={setApplicationIds}
          hint={t('fileEditor.applicationsHint')}
        />

        <TextField label={t('fileEditor.note')} value={note} multiline onChangeText={setNote} />
      </View>

      <ConfirmSheet
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={t('common:discard.title')}
        description={t('common:discard.description')}
        confirmLabel={t('common:discard.confirm')}
        tone="danger"
        onConfirm={() => {
          setDiscarding(false)
          onClose()
        }}
      />
    </Sheet>
  )
}
