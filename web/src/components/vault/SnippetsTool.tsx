import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Pencil, Plus, Quote, X } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { SNIPPET_TAGS, snippets, type SnippetTag } from '@/data/vault'
import { useLabels } from '@/lib/labels-context'
import { cn } from '@/lib/utils'

/** How long the copied confirmation stays up. */
const COPIED_MS = 1600

/**
 * The answers you retype on every form, ready to paste.
 *
 * The one tool in the vault that is fully functional today: copying to the
 * clipboard needs no local store, so this works now rather than waiting on
 * persistence like the files tool does.
 */
export function SnippetsTool() {
  const [tag, setTag] = useState<SnippetTag | 'all'>('all')
  const { matches } = useLabels()
  /** The snippet open in the editor, and its working copy as HTML. */
  const [editing, setEditing] = useState<{ id: string | null; title: string; html: string } | null>(
    null,
  )
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of snippets) map[s.tag] = (map[s.tag] ?? 0) + 1
    return map
  }, [])

  const visible = snippets.filter((s) => (tag === 'all' || s.tag === tag) && matches(s.id))

  const copy = async (id: string, body: string) => {
    clearTimeout(timer.current)
    try {
      // Unavailable outside a secure context, and some browsers refuse without
      // a permission — hence the catch and the visible failure state, rather
      // than a confirmation for something that did not happen.
      await navigator.clipboard.writeText(body)
      setFailed(false)
      setCopiedId(id)
    } catch {
      setFailed(true)
      setCopiedId(id)
    }
    timer.current = setTimeout(() => setCopiedId(null), COPIED_MS)
  }

  const openEditor = (s?: { id: string; title: string; body: string }) =>
    setEditing(
      s
        ? // Plain-text bodies carry their own line breaks; the editor speaks
          // HTML, so they have to be converted or the paragraphs collapse.
          {
            id: s.id,
            title: s.title,
            html: s.body
              .split('\n')
              .map((l) => `<p>${l || '<br>'}</p>`)
              .join(''),
          }
        : { id: null, title: 'New snippet', html: '' },
    )

  return (
    <div className="flex flex-wrap items-start gap-4 sm:gap-5">
      <Panel className={cn('min-w-0', editing ? 'flex-1 basis-[320px]' : 'w-full')}>
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
          <BucketFilter
            label="Filter snippets by kind"
            options={SNIPPET_TAGS}
            counts={counts}
            value={tag}
            onChange={setTag}
            total={snippets.length}
          />
          <Button size="sm" onClick={() => openEditor()}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            New snippet
          </Button>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={Quote}
            title="No snippets here yet"
            description="Save the paragraphs you keep rewriting — the bio, the why-this-department, the follow-up email."
          />
        ) : (
          <ul className={cn('grid gap-3', editing ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2')}>
            {visible.map((s) => {
              const isCopied = copiedId === s.id
              return (
                <li key={s.id} className="well flex min-w-0 flex-col rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text-1">{s.title}</div>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Chip shape="capsule" tone="gray">
                          {s.tag}
                        </Chip>
                        <LabelChips recordId={s.id} />
                      </span>
                    </div>

                    <LabelPicker recordId={s.id} />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${s.title}`}
                      title="Edit"
                      onClick={() => openEditor(s)}
                      className="shrink-0"
                    >
                      <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copy(s.id, s.body)}
                      className="shrink-0"
                    >
                      {isCopied ? (
                        <Check className="size-3.5" strokeWidth={2} aria-hidden />
                      ) : (
                        <Copy className="size-3.5" strokeWidth={1.8} aria-hidden />
                      )}
                      {isCopied ? (failed ? 'Blocked' : 'Copied') : 'Copy'}
                    </Button>
                  </div>

                  {/* whitespace-pre-line so the email templates keep their breaks. */}
                  <p className="mt-2.5 line-clamp-4 text-xs whitespace-pre-line text-text-2">
                    {s.body}
                  </p>
                </li>
              )
            })}
          </ul>
        )}

        {/* Announced rather than only shown: the confirmation appears on a button
          the user has just left, and colour changes alone are easy to miss. */}
        <p aria-live="polite" className="sr-only">
          {copiedId
            ? failed
              ? 'Copy was blocked by the browser'
              : 'Snippet copied to clipboard'
            : ''}
        </p>
      </Panel>

      {editing ? (
        <Panel className="flex min-w-0 flex-1 basis-[380px] flex-col">
          <div className="mb-3 flex items-start justify-between gap-3">
            <PanelTitle className="mb-0 truncate">{editing.title}</PanelTitle>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} className="shrink-0">
              <X className="size-3.5" strokeWidth={2} aria-hidden />
              Close
            </Button>
          </div>

          <RichTextEditor
            value={editing.html}
            onChange={(html) => setEditing((prev) => (prev ? { ...prev, html } : prev))}
            placeholder="Write the paragraph you keep rewriting…"
          />

          <p className="mt-3 text-xs text-text-3">
            Edits stay in this session — saving arrives with the local store.
          </p>
        </Panel>
      ) : null}
    </div>
  )
}
