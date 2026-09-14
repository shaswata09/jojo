import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { displayName } from '@/data/seed'
import type { Application } from '@/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'
import { encodeFormat } from '@jojo/service/core/note-format'
import type { NodeId } from '@jojo/service/core/model'
import { useGraph } from '@jojo/service/react/kg-context'
import { htmlFromNote, noteFromRuns } from '@/lib/note-html'
import { rawRunsFromHtml } from '@/lib/note-runs'
import { useToast } from '@/lib/toast-context'

/**
 * The free-text note on the record, with its formatting.
 *
 * Mounted under the record's `key`, so the draft below belongs to one
 * application — without that, navigating between two of them would carry the
 * first one's unsaved note across.
 *
 * ## The note's TEXT is still plain, and that is what makes this cheap
 *
 * `ApplicationProps.note` is the same string it always was. Six surfaces print
 * it straight out — the applications table, the ⌘K result, the list's search
 * haystack, the edit dialog's own Note box, the duplicate preview, and the
 * organisation page's unclamped line — and not one of them changed. The
 * formatting is a sibling prop of offsets over that text, so bolding a word
 * cannot put markup in a table cell, which is exactly what the rich-text box
 * tried here before this one did.
 *
 * ## Inline only
 *
 * No lists and no table: the store holds spans over one string, and a table has
 * nowhere to go. Offering the button and dissolving the table on save would be
 * worse than not offering it. A person who wants bullets types `- `, which is
 * text and survives every reader.
 *
 * ## The commit must not read the DOM
 *
 * It fires from the unmount cleanup as well as from blur — that is the Escape
 * path the panel has always had — and by then the `contentEditable` may be
 * detached, where reading `innerHTML` yields ''. `RichTextEditor` calls
 * `onChange` on every input, so the draft is already in state and the cleanup
 * needs no element at all.
 */
export function NotePanel({ application: a }: { application: Application }) {
  const { setNote } = useApplications()
  const graph = useGraph()
  const { toast } = useToast()

  // Off the node, not off the projection: `applicationFrom` drops the spans on
  // purpose so twenty of them do not ride into sixty card props.
  const stored = graph.node(a.id as NodeId, 'application')?.props.noteFormat

  const [html, setHtml] = useState(() => htmlFromNote(a.note, stored))
  const [saved, setSaved] = useState(false)

  const commit = () => {
    const { text, format, dropped } = noteFromRuns(rawRunsFromHtml(html))
    // Nothing changed — a blur straight after an unmount, or a click away from
    // a note nobody touched. Writing anyway would stamp `lastActionAt` and take
    // the top of the undo stack.
    if (text === a.note && encodeFormat(format) === encodeFormat(stored)) return
    setNote(a.id, text, encodeFormat(format) ?? '')
    setSaved(true)

    /*
     * Said in a toast rather than on the panel, because this also fires from
     * the unmount cleanup — by which point there is no panel left to print on.
     */
    if (dropped.colour > 0 || dropped.size > 0 || dropped.overflow > 0) {
      toast({
        title: 'Note saved, with some formatting dropped',
        description:
          dropped.overflow > 0
            ? 'This note carries more formatting than jojo stores; the rest was kept as plain text.'
            : 'Colours and sizes jojo does not have were kept as plain text.',
      })
    }
  }

  /*
   * The same commit, on the way out.
   *
   * `onBlur` alone lost the edit whenever the drawer closed WITHOUT the field
   * blurring first — which is what Escape does, and Escape is the documented
   * way to dismiss it. Through a ref so the cleanup does not re-run on every
   * keystroke; `commit` is idempotent, so a blur followed by an unmount writes
   * once.
   */
  const latest = useRef(commit)
  latest.current = commit
  useEffect(() => () => latest.current(), [])

  const label = useMemo(() => `Note on ${displayName(a)}`, [a])

  return (
    <Panel className="min-w-0">
      <PanelTitle hint="Saves when you click away">Note</PanelTitle>
      <RichTextEditor
        value={html}
        onChange={(next) => {
          setHtml(next)
          setSaved(false)
        }}
        onBlur={commit}
        inlineOnly
        placeholder="What is still outstanding, who you spoke to, what to ask next"
        ariaLabel={label}
        className="min-h-[7.5rem]"
      />
      <p role="status" className="mt-1.5 text-xs text-text-3">
        {saved ? 'Note saved' : null}
      </p>
    </Panel>
  )
}
