import type { ReactNode } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { i18next } from '@/i18n/i18n'

/**
 * Which destructive data action is waiting on a confirmation.
 *
 * `reset` is gone, and it was never a third thing. It ran `memory.reset` — the
 * same write as *Demo data*, described in a different tense ("put the seeded
 * records back" against "load the seeded records"), and which of the two a user
 * got depended on whether the store happened to be empty when they arrived. One
 * button, named for what it does to their records, is the version that can be
 * read without already knowing the answer.
 */
export type PendingData = 'demo' | 'empty' | 'storage'

/**
 * The words each confirmation says, given what is actually in the store.
 *
 * Every branch here exists because the sentence is only true in one of the two
 * cases: `durable` says whether a reload will remember the outcome,
 * `untouchedDemo` whether anything in the store is the user's yet, and
 * `demoReplacesNothing` whether loading the demo data replaces something or
 * fills a void. That last one is `useStoreAdmin`'s, and it counts keywords and
 * every other record type, not only the lists on the board: it used to be the
 * panel's `isEmpty`, which ignored notes, conversations, contacts, CV facts and
 * keywords, so this dialog promised to replace nothing, hid the export, and the
 * load deleted them.
 */
export function pendingCopy({
  untouchedDemo,
  demoReplacesNothing,
  durable,
  onExport,
}: {
  untouchedDemo: boolean
  demoReplacesNothing: boolean
  /** Whether a reload will remember the outcome — each sentence is written both ways. */
  durable: boolean
  onExport: () => void
}): Record<PendingData, { title: string; description: ReactNode; confirm: string }> {
  // At call time, never at import: the panel calls this on every render, so a
  // change of language reaches the dialog on the next one.
  const t = i18next.getFixedT(null, 'settings')
  /**
   * The export, offered inside the confirmation rather than only in the panel
   * behind it.
   *
   * This is the last moment it is worth anything: the dialog is open because the
   * user is about to replace or delete every record in the store, and "you should
   * have exported first" is a sentence that can only be said afterwards. It does
   * not close the dialog — the download starts, the toast fires, and the
   * confirmation is still there to be taken or cancelled.
   *
   * `flex w-fit` rather than the default inline-flex: this renders inside
   * `DialogDescription`, which is a `<p>`, so an inline button lands at the end
   * of the last line of prose looking like a word that grew a border.
   */
  const exportFirst = (
    <Button variant="outline" size="sm" className="mt-3 flex w-fit" onClick={onExport}>
      <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
      {t('pending.exportFirst')}
    </Button>
  )

  return {
    empty: {
      title: t('pending.empty.title'),
      description: (
        <>
          {untouchedDemo
            ? t(durable ? 'pending.empty.demoDurable' : 'pending.empty.demoMemory')
            : t(durable ? 'pending.empty.ownDurable' : 'pending.empty.ownMemory')}
          {/* The documents' files are not erased at once: they sit in the
              browser's trash for 30 days first (see `onClearRecords`), and a
              dialog that said "the vault … all go" let somebody stop looking
              for them (finding docs-1). Named with the control that does erase
              them now, so the way out is in the sentence. */}
          {untouchedDemo
            ? null
            : ` ${t('pending.empty.documentsKept', { storage: t('data.clearStorage.label') })}`}
          {untouchedDemo ? null : exportFirst}
        </>
      ),
      confirm: t('pending.empty.confirm'),
    },
    demo: {
      title: t('pending.demo.title'),
      description: (
        <>
          {demoReplacesNothing
            ? t(durable ? 'pending.demo.fillDurable' : 'pending.demo.fillMemory')
            : t('pending.demo.replace')}
          {demoReplacesNothing ? null : exportFirst}
        </>
      ),
      confirm: t('pending.demo.confirm'),
    },
    // Says what it reaches AND what it cannot. jojo has no server, so a
    // dialog offering to clear one would be inventing a thing to reassure
    // the reader about; the honest version is that there is nothing there.
    storage: {
      title: t('pending.storage.title'),
      description: (
        <>
          {t('pending.storage.description')}
          {exportFirst}
        </>
      ),
      confirm: t('pending.storage.confirm'),
    },
  }
}
