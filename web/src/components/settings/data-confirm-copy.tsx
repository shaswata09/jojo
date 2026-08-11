import type { ReactNode } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
 * cases: `persists` carries whether a reload will remember the outcome,
 * `untouchedDemo` whether anything in the store is the user's yet, and `isEmpty`
 * whether loading the demo data replaces something or fills a void.
 */
export function pendingCopy({
  untouchedDemo,
  isEmpty,
  durable,
  persists,
  onExport,
}: {
  untouchedDemo: boolean
  isEmpty: boolean
  durable: boolean
  /** The clause about the next reload, spelled by the panel that owns it. */
  persists: string
  onExport: () => void
}): Record<PendingData, { title: string; description: ReactNode; confirm: string }> {
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
      Export a backup first
    </Button>
  )

  return {
    empty: {
      title: 'Clear every record?',
      description: (
        <>
          {untouchedDemo
            ? `The demo applications, timeline, vault, saved postings, keywords and profile all go, ${persists}. Nothing here was yours — this store has not been written to since the demo data was loaded.`
            : `Applications, the timeline, the vault, saved postings and your profile all go, including anything you added this session, ${persists}. There is no undo. Your keywords are kept — they are records of their own — but nothing is left carrying them, so every count in the keyword panel goes to zero.`}
          {untouchedDemo ? null : exportFirst}
        </>
      ),
      confirm: 'Clear everything',
    },
    demo: {
      title: 'Load the demo data?',
      description: (
        <>
          {isEmpty
            ? `Twelve applications, a timeline, a stocked vault and a profile${durable ? ' are written to your database' : ' are loaded'}, tagged with the keywords they shipped with. Clearing them again is one press.`
            : 'Everything in jojo is replaced by the seeded records — your applications, timeline, vault, saved postings, keywords and profile, all of it, replaced rather than merged. There is no undo.'}
          {isEmpty ? null : exportFirst}
        </>
      ),
      confirm: 'Load demo data',
    },
    // Says what it reaches AND what it cannot. jojo has no server, so a
    // dialog offering to clear one would be inventing a thing to reassure
    // the reader about; the honest version is that there is nothing there.
    storage: {
      title: 'Clear everything this site has stored?',
      description: (
        <>
          Empties this browser of everything jojo has put in it — your records and their database,
          your theme and sound preferences, any caches and cookies — and then reloads. There is no
          server holding a copy, and nothing here has ever left this machine, so this is all of it.
          jojo comes back as it would on a new machine: the system theme, and the question it asks
          on a first run about whether to start with the demo data or empty. There is no undo.
          {exportFirst}
        </>
      ),
      confirm: 'Clear storage',
    },
  }
}
