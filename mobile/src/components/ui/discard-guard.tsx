import { useState } from 'react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'

/**
 * "Discard unsaved changes?" for a form sheet, asked only when something typed
 * would be lost.
 *
 * `FileEditor` and the snippet editor already asked, as the web's snippet
 * editor does. The reminder sheet, the link editor and the person editor did
 * not: the backdrop, Cancel, the X and Android Back all closed them with the
 * typed text gone and no undo, because a record that was never written leaves
 * the journal nothing to restore.
 *
 * Route every way out through `close`, render `guard` inside the sheet, and
 * pass `dirty` measured against what the form opened with — so tapping into a
 * field and back out is not a change. The words are the shared
 * `common:discard.*` ones the two editors use.
 */
export function useDiscardGuard(
  dirty: boolean,
  onClose: () => void,
): { close: () => void; guard: ReactElement } {
  const { t } = useTranslation('common')
  const [asking, setAsking] = useState(false)
  const close = () => {
    if (dirty) setAsking(true)
    else onClose()
  }
  const guard = (
    <ConfirmSheet
      open={asking}
      onClose={() => setAsking(false)}
      title={t('discard.title')}
      description={t('discard.description')}
      confirmLabel={t('discard.confirm')}
      tone="danger"
      onConfirm={onClose}
    />
  )
  return { close, guard }
}
