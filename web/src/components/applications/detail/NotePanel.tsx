import { useEffect, useRef, useState } from 'react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Textarea } from '@/components/ui/textarea'
import { displayName } from '@/data/seed'
import type { Application } from '@/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'

/**
 * The free-text note on the record.
 *
 * Mounted under the record's `key`, so the draft below belongs to one
 * application — without that, navigating between two of them would carry the
 * first one's unsaved note across.
 */
export function NotePanel({ application: a }: { application: Application }) {
  const { update } = useApplications()
  const [note, setNote] = useState(a.note)
  const [noteSaved, setNoteSaved] = useState(false)

  /**
   * The note is stored as plain text, and the field has to be one too.
   *
   * Six surfaces read this string — the board card, the table row, the ⌘K
   * result, the edit dialog's own Note box, the list's search haystack and the
   * seed — and every one of them prints it straight out. A rich-text box here
   * wrote its `innerHTML` into the field, so bolding a word left literal
   * `<span style="font-weight: bold;">` sitting on the board.
   *
   * Trimmed on the way in, and the field follows, so whitespace alone is not a
   * note and blurring twice does not write twice.
   */
  const commitNote = () => {
    const next = note.trim()
    if (next === a.note) return
    setNote(next)
    update(a.id, { note: next, lastAction: 'Note edited' })
    setNoteSaved(true)
  }

  /*
   * The same commit, on the way out.
   *
   * `onBlur` alone lost the edit whenever the drawer closed WITHOUT the field
   * blurring first — which is what Escape does, and Escape is the documented way
   * to dismiss it. Type a note, press Escape, reopen: gone, with no warning and
   * no unsaved marker. Clicking away inside the drawer saved correctly, so the
   * loss was unpredictable rather than obvious, which is worse.
   *
   * Through a ref because the cleanup must not re-run on every keystroke: the
   * effect stays mounted for the life of the panel and reads the latest draft
   * when it finally tears down. `commitNote` is idempotent — it returns early
   * when nothing changed — so a blur immediately followed by an unmount writes
   * once.
   */
  const latest = useRef(commitNote)
  latest.current = commitNote
  useEffect(() => () => latest.current(), [])

  return (
    <Panel className="min-w-0">
      <PanelTitle hint="Saves when you click away">Note</PanelTitle>
      {/* Commits on blur rather than on every keystroke: a dispatch behind
          each character would reset `daysAgo` while you typed. The box starts
          at ~120px and grows with what is typed — `field-sizing-content` on
          the shared Textarea — because the note is empty on ten of twelve
          records and a permanent tall box for it would be all promise. */}
      <Textarea
        value={note}
        onChange={(event) => {
          setNote(event.target.value)
          setNoteSaved(false)
        }}
        onBlur={commitNote}
        placeholder="What is still outstanding, who you spoke to, what to ask next"
        aria-label={`Note on ${displayName(a)}`}
        className="min-h-[7.5rem]"
      />
      <p role="status" className="mt-1.5 text-xs text-text-3">
        {noteSaved ? 'Note saved' : null}
      </p>
    </Panel>
  )
}
