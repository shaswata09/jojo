import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Copy, CopyPlus, Pencil, Plus, Quote, Trash2, X } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { Chip } from '@/components/common/Chip'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Field, FormField } from '@/components/common/Field'
import { KeywordPicker } from '@/components/common/KeywordPicker'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { ExpandButton, FullScreenDialog } from '@/components/common/FullScreen'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { MenuItem, MenuSection, RowMenu } from '@/components/vault/RowMenu'
import { VaultSearch, VaultToolbar, matchesQuery } from '@/components/vault/VaultToolbar'
import { SNIPPET_TAGS } from '@/data/vault'
import type { Snippet, SnippetTag } from '@/data/vault'
import { useVault } from '@/kg/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { htmlFromText, textFromHtml } from '@/lib/rich-text'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { cn } from '@/lib/utils'

/** How long the copied confirmation stays up. */
const COPIED_MS = 1600

const TAG_OPTIONS = SNIPPET_TAGS.map((t) => ({ value: t, label: t }))

/** The editor's working copy. `id` is null until the snippet has been saved once. */
type Draft = {
  id: string | null
  title: string
  tag: SnippetTag
  html: string
  /** Staged, not written on click — see `KeywordPicker`. Cancel discards them. */
  keywords: string[]
}

/** What the draft looked like when it was opened, for the dirty check. */
type Clean = { title: string; tag: SnippetTag; body: string; keywords: string }

/** Order-insensitive, because picking A then B is the same set as B then A. */
const keywordKey = (ids: readonly string[]) => [...ids].sort().join(',')

/** Deciding what to do after the discard warning is answered. */
type Pending = { kind: 'close' } | { kind: 'open'; snippet?: Snippet }

/**
 * The answers you retype on every form, ready to paste.
 *
 * Copying needs no store and has always worked. Writing is what was missing:
 * the editor had no save, so "New snippet" created nothing and every edit was
 * discarded by the button that closed the panel.
 */
export function SnippetsTool({ focus }: { focus?: string }) {
  const [tagFilter, setTagFilter] = useState<SnippetTag | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Draft | null>(null)
  /** Whether the snippet text is being written full screen. */
  const [fullText, setFullText] = useState(false)
  /** Short alias — it is read all through the editor markup below. */
  const full = fullText

  // Closing the editor, or switching to another snippet, has to take the full
  // screen with it — otherwise saving from the overlay leaves a dialog open
  // over an editor that no longer has a draft behind it.
  useEffect(() => {
    if (!editing) setFullText(false)
  }, [editing])
  const [clean, setClean] = useState<Clean | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const {
    matches,
    selected: selectedLabels,
    clearSelected,
    labelIdsOf,
    setRecord,
    removeRecord,
  } = useLabels()
  const { snippets, addSnippet, updateSnippet, removeSnippet } = useVault()
  const { toast } = useToast()
  // Arrived from a graph node or a query row that named one snippet — see
  // `focus` in links.ts. These are cards on a two-column grid, so which one was
  // meant is even less guessable than in a list.
  const focusedCard = useArrivalScroll<HTMLLIElement>(focus)

  useEffect(() => () => clearTimeout(timer.current), [])

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const s of snippets) map[s.tag] = (map[s.tag] ?? 0) + 1
    return map
  }, [snippets])

  const visible = snippets.filter(
    (s) =>
      (tagFilter === 'all' || s.tag === tagFilter) &&
      matches(s.id) &&
      matchesQuery(query, s.title, s.body, s.tag),
  )

  /**
   * Replaces the record's whole keyword set, or forgets it when none are left.
   *
   * Timeline items and snippets are keyed by their bare id in the label store,
   * not by `refKey('snippet', id)` — that is how `seedLabelsByRecord` spells
   * them ('s-bio-short'), and a prefixed key would file keywords where no
   * surface looks for them.
   */
  const commitKeywords = (id: string, ids: string[]) => {
    if (ids.length > 0) setRecord(id, ids)
    // `setRecord(id, [])` files the record as carrying no keywords, which is a
    // different thing from never having been mentioned.
    else removeRecord(id)
  }

  /** What Save would write. Also what the dirty check compares. */
  const body = useMemo(() => (editing ? textFromHtml(editing.html) : ''), [editing])

  /**
   * Compared on the stored text, not on the editor's HTML.
   *
   * The editor rewrites the markup it is given the moment it mounts, so an HTML
   * comparison would call an untouched draft dirty. Text is also the honest
   * test: the body is stored as plain text, so a change that survives Save is
   * the only kind worth warning about.
   */
  const dirty =
    editing !== null &&
    clean !== null &&
    (editing.title !== clean.title ||
      editing.tag !== clean.tag ||
      body !== clean.body ||
      keywordKey(editing.keywords) !== clean.keywords)

  const copy = async (id: string, text: string) => {
    clearTimeout(timer.current)
    try {
      // Unavailable outside a secure context, and some browsers refuse without
      // a permission — hence the catch and the visible failure state, rather
      // than a confirmation for something that did not happen.
      await navigator.clipboard.writeText(text)
      setFailed(false)
      setCopiedId(id)
    } catch {
      setFailed(true)
      setCopiedId(id)
    }
    timer.current = setTimeout(() => setCopiedId(null), COPIED_MS)
  }

  const openEditor = (s?: Snippet) => {
    const draft: Draft = s
      ? {
          id: s.id,
          title: s.title,
          tag: s.tag,
          html: htmlFromText(s.body),
          keywords: labelIdsOf(s.id),
        }
      : {
          id: null,
          title: '',
          // A new snippet takes the kind being looked at, so writing one while
          // filtered does not file it somewhere the list cannot show it.
          tag: tagFilter === 'all' ? 'Cover letter' : tagFilter,
          html: '',
          keywords: [],
        }
    setEditing(draft)
    // The baseline is the round trip, not the stored body. A body with a
    // trailing space on a line comes back one character shorter, and comparing
    // against the original would mark an editor nobody has typed in as dirty.
    setClean({
      title: draft.title,
      tag: draft.tag,
      body: textFromHtml(draft.html),
      keywords: keywordKey(draft.keywords),
    })
    setSubmitted(false)
  }

  const closeEditor = () => {
    setEditing(null)
    setClean(null)
    setSubmitted(false)
  }

  // Every route out of the editor goes through the dirty check, including
  // opening a different snippet — the old panel closed on Close, on Edit and on
  // New alike, and threw the work away each time without saying so.
  const requestOpen = (s?: Snippet) =>
    dirty ? setPending({ kind: 'open', snippet: s }) : openEditor(s)
  const requestClose = () => (dirty ? setPending({ kind: 'close' }) : closeEditor())

  const titleError = submitted && !editing?.title.trim() ? 'Give the snippet a name.' : undefined
  const bodyError =
    submitted && editing?.title.trim() && !body
      ? 'Write the text you want to paste later.'
      : undefined

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    setSubmitted(true)

    const title = editing.title.trim()
    if (!title || !body) return

    const chosen = editing.keywords

    if (editing.id) {
      const id = editing.id
      // Read before the write, or Undo restores what it just created.
      const before = snippets.find((s) => s.id === id)
      const beforeKeywords = labelIdsOf(id)

      updateSnippet(id, { title, tag: editing.tag, body })
      commitKeywords(id, chosen)
      // The draft takes the trimmed title too, or the dirty check compares
      // 'Short bio ' against the 'Short bio' that was stored and the panel keeps
      // claiming unsaved changes forever.
      setEditing((prev) => (prev ? { ...prev, title } : prev))
      setClean({ title, tag: editing.tag, body, keywords: keywordKey(chosen) })
      toast({
        title: `${title} saved`,
        description: `Filed under ${editing.tag}, ready to copy from the list.`,
        action: {
          label: 'Undo',
          onClick: () => {
            if (before) updateSnippet(id, before)
            commitKeywords(id, beforeKeywords)
            // The panel is very likely still open on this record, so it has to
            // be handed the restored values as well — otherwise Undo puts the
            // store back and leaves the editor claiming the new text is saved.
            setEditing((prev) =>
              prev?.id === id && before
                ? {
                    ...prev,
                    title: before.title,
                    tag: before.tag,
                    html: htmlFromText(before.body),
                    keywords: beforeKeywords,
                  }
                : prev,
            )
            setClean(
              before
                ? {
                    title: before.title,
                    tag: before.tag,
                    body: before.body,
                    keywords: keywordKey(beforeKeywords),
                  }
                : null,
            )
          },
        },
      })
      return
    }

    const record = addSnippet({ title, tag: editing.tag, body })
    commitKeywords(record.id, chosen)

    // The editor stays open on the record it just created rather than closing:
    // the first save is usually followed by another edit.
    setEditing({ ...editing, id: record.id, title })
    setClean({ title, tag: editing.tag, body, keywords: keywordKey(chosen) })

    // Saved into a list the filters are hiding is the one outcome that looks
    // like a dropped write, so it gets named rather than a bare confirmation.
    const hidden =
      (tagFilter !== 'all' && record.tag !== tagFilter) ||
      (selectedLabels.size > 0 && !chosen.some((id) => selectedLabels.has(id))) ||
      !matchesQuery(query, title, body, record.tag)

    toast({
      title: `${title} saved`,
      description: hidden
        ? `Filed under ${record.tag} — hidden by the filters above the list.`
        : `Filed under ${record.tag}, ready to copy from the list.`,
      action: hidden
        ? {
            label: 'Show it',
            onClick: () => {
              setTagFilter('all')
              setQuery('')
              clearSelected()
            },
          }
        : {
            label: 'Undo',
            onClick: () => {
              removeSnippet(record.id)
              removeRecord(record.id)
              closeEditor()
            },
          },
    })
  }

  const onDuplicate = (s: Snippet) => {
    const copy = addSnippet({ title: `${s.title} (copy)`, tag: s.tag, body: s.body })
    const keywords = labelIdsOf(s.id)
    if (keywords.length > 0) setRecord(copy.id, keywords)
    toast({
      title: `${s.title} duplicated`,
      description: `The copy is filed under ${copy.tag}, ready to be rewritten.`,
      action: {
        label: 'Undo',
        onClick: () => {
          removeSnippet(copy.id)
          removeRecord(copy.id)
        },
      },
    })
  }

  const onMove = (s: Snippet, next: SnippetTag) => {
    const before = s.tag
    updateSnippet(s.id, { tag: next })
    if (editing?.id === s.id) setEditing((prev) => (prev ? { ...prev, tag: next } : prev))
    toast({
      title: `${s.title} moved`,
      description: `Filed under ${next}${tagFilter !== 'all' && tagFilter !== next ? ` — out of the ${tagFilter} list you are looking at` : ''}.`,
      action: { label: 'Undo', onClick: () => updateSnippet(s.id, { tag: before }) },
    })
  }

  /**
   * A snippet is several paragraphs someone wrote by hand — which is exactly
   * why it goes on an undo toast rather than a confirmation dialog. The dialog
   * that used to stand here was a second modal in front of an action that
   * restores perfectly, and it could not describe the one thing that was
   * genuinely at stake: the keywords, which the undo puts back with the text.
   */
  const onDelete = (id: string) => {
    const doomed = snippets.find((s) => s.id === id)
    const stashed = labelIdsOf(id)

    const { restore } = removeSnippet(id)
    removeRecord(id)
    if (editing?.id === id) closeEditor()

    toast({
      title: `${doomed?.title ?? 'Snippet'} deleted`,
      description: 'The text and its keywords go with it.',
      tone: 'danger',
      action: {
        label: 'Undo',
        onClick: () => {
          restore()
          // Guarded: `setRecord` with an empty list files the record as carrying
          // no keywords rather than leaving it unmentioned.
          if (stashed.length > 0) setRecord(id, stashed)
        },
      },
    })
  }

  /**
   * Every empty list names the control that emptied it. "No snippets here yet"
   * over a vault holding eight of them, because a chip above the list is set,
   * is the fastest way to make someone think the app lost their writing.
   */
  const empty = (() => {
    if (snippets.length === 0) {
      return {
        title: 'No snippets yet',
        description:
          'Save the paragraphs you keep rewriting — the bio, the why-this-department, the follow-up email.',
        action: (
          <Button size="sm" onClick={() => requestOpen()}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            New snippet
          </Button>
        ),
      }
    }
    if (query.trim()) {
      return {
        title: 'Nothing matches that search',
        description: `No snippet mentions "${query.trim()}" in its name, text or kind.`,
        action: (
          <Button variant="outline" size="sm" onClick={() => setQuery('')}>
            Clear search
          </Button>
        ),
      }
    }
    const byTag = tagFilter !== 'all'
    const byKeyword = selectedLabels.size > 0

    if (byTag && byKeyword) {
      return {
        title: 'Nothing matches both filters',
        description: `No ${tagFilter} snippet carries the selected keywords.`,
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTagFilter('all')
              clearSelected()
            }}
          >
            Clear both filters
          </Button>
        ),
      }
    }
    if (byTag) {
      return {
        title: `No ${tagFilter} snippets`,
        description: `${snippets.length} snippets are filed under the other kinds.`,
        action: (
          <Button variant="outline" size="sm" onClick={() => setTagFilter('all')}>
            Show all kinds
          </Button>
        ),
      }
    }
    return {
      title: 'No snippets carry those keywords',
      description: 'The keyword filter at the top of the page is what is hiding them.',
      action: (
        <Button variant="outline" size="sm" onClick={clearSelected}>
          Clear keywords
        </Button>
      ),
    }
  })()

  return (
    <div className="flex flex-wrap items-start gap-4 sm:gap-5">
      <Panel className={cn('min-w-0', editing ? 'flex-1 basis-[320px]' : 'w-full')}>
        {snippets.length > 0 ? (
          <VaultToolbar
            filter={
              <BucketFilter
                label="Filter snippets by kind"
                options={SNIPPET_TAGS}
                counts={counts}
                value={tagFilter}
                onChange={setTagFilter}
                total={snippets.length}
              />
            }
            search={
              <VaultSearch
                label="Search snippets"
                placeholder="Search name or text"
                value={query}
                onChange={setQuery}
              />
            }
            action={
              <Button size="sm" onClick={() => requestOpen()}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                New snippet
              </Button>
            }
          />
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            icon={Quote}
            title={empty.title}
            description={empty.description}
            action={empty.action}
          />
        ) : (
          <ul className={cn('grid gap-3', editing ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2')}>
            {visible.map((s) => {
              const isCopied = copiedId === s.id
              return (
                <li
                  key={s.id}
                  ref={s.id === focus ? focusedCard : undefined}
                  className={cn(
                    'well flex min-w-0 flex-col rounded-lg p-3',
                    // The row the editor is working on, so it is obvious which
                    // record the panel beside the list belongs to.
                    editing?.id === s.id && 'ring-1 ring-accent-border',
                    // The `-well` variant, not the plain one: this card has its
                    // own fill for the tint to fade back to.
                    s.id === focus && 'arrival-highlight-well',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {/* A button, not a div. It sat next to a pencil that did
                          the same thing, and looked exactly like the reminder
                          titles one tab over, which have always been clickable. */}
                      <button
                        type="button"
                        onClick={() => requestOpen(s)}
                        title="Edit this snippet"
                        className="block max-w-full cursor-pointer truncate text-left text-sm text-text-1 transition-colors hover:text-accent"
                      >
                        {s.title}
                      </button>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Chip shape="capsule" tone="gray">
                          {s.tag}
                        </Chip>
                        <LabelChips recordId={s.id} />
                      </span>
                    </div>

                    <LabelPicker recordId={s.id} />
                    {/* Copy stays out in the open on every card: it is what a
                        snippet is for, and burying the primary action of a
                        record behind ⋯ to make room for Edit would be the wrong
                        way round. */}
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
                    <RowMenu name={s.title}>
                      <MenuItem icon={Pencil} onSelect={() => requestOpen(s)}>
                        Edit
                      </MenuItem>
                      <MenuItem icon={CopyPlus} onSelect={() => onDuplicate(s)}>
                        Duplicate
                      </MenuItem>
                      <MenuSection title="Move to">
                        {SNIPPET_TAGS.map((t) => (
                          <MenuItem key={t} current={t === s.tag} onSelect={() => onMove(s, t)}>
                            {t}
                          </MenuItem>
                        ))}
                      </MenuSection>
                      <MenuSection>
                        {/* Snippets had no delete at all before this — the only
                            way to remove one was to open the editor. */}
                        <MenuItem icon={Trash2} danger onSelect={() => onDelete(s.id)}>
                          Delete
                        </MenuItem>
                      </MenuSection>
                    </RowMenu>
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

      {/* One form, rendered either in the side panel or full screen.
          Everything the card offers — title, kind, keywords, delete, save —
          goes with it, because an editor that drops half its controls when it
          gets bigger is the wrong way round. The draft lives in `editing`,
          above this, so moving between the two costs the caret and nothing
          else. */}
      {editing
        ? (() => {
            const form = (
              /* noValidate: `required` stays on the fields for assistive tech,
                 and without it the browser's own bubble fires over the message
                 written for the field. */
              <form
                noValidate
                onSubmit={save}
                className={cn('flex min-h-0 flex-col gap-3', full && 'flex-1 overflow-y-auto')}
              >
                <div className="flex items-start justify-between gap-3">
                  <PanelTitle className="mb-0" hint={dirty ? 'Unsaved changes' : undefined}>
                    {editing.id ? 'Edit snippet' : 'New snippet'}
                  </PanelTitle>
                  {/* Dropped full screen, where the dialog already puts an X in
                      the same corner — two dismissals stacked on top of each
                      other read as two different scopes when the one below is
                      just the way out. Kept in the side panel, which has no
                      chrome of its own and would otherwise have no exit but
                      Cancel at the foot of the form. */}
                  {full ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={requestClose}
                      className="shrink-0"
                    >
                      <X className="size-3.5" strokeWidth={2} aria-hidden />
                      Close
                    </Button>
                  )}
                </div>

                <Field
                  label="Title"
                  required
                  error={titleError}
                  value={editing.title}
                  autoComplete="off"
                  placeholder="e.g. Why this department"
                  onChange={(event) =>
                    setEditing((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                  }
                />

                <FormField label="Kind" hint="Where it files, and which chip the list shows.">
                  <Segment
                    label="Kind"
                    options={TAG_OPTIONS}
                    value={editing.tag}
                    onChange={(next) =>
                      setEditing((prev) => (prev ? { ...prev, tag: next } : prev))
                    }
                    className="flex-wrap gap-1 rounded-xl"
                  />
                </FormField>

                <FormField
                  label="Text"
                  required
                  error={bodyError}
                  hint="Stored as plain text — line breaks survive, the formatting buttons do not."
                >
                  <div className="relative">
                    {/* Over the toolbar's right end rather than beside the field
                    label: it acts on the editor, and the editor is what it sits
                    on. z-[1] clears the toolbar's own background. Hidden once
                    expanded — the dialog's own close is the way back. */}
                    {full ? null : (
                      <ExpandButton
                        onClick={() => setFullText(true)}
                        label="Write full screen"
                        className="absolute top-1.5 right-1.5 z-[1]"
                      />
                    )}
                    <RichTextEditor
                      value={editing.html}
                      onChange={(html) => setEditing((prev) => (prev ? { ...prev, html } : prev))}
                      placeholder="Write the paragraph you keep rewriting…"
                      className={full ? 'min-h-0 flex-1' : undefined}
                    />
                  </div>
                </FormField>

                <FormField
                  label="Keywords"
                  hint="Shared with applications, reminders and files — filtering by one finds all of them."
                >
                  <KeywordPicker
                    value={editing.keywords}
                    onChange={(next) =>
                      setEditing((prev) => (prev ? { ...prev, keywords: next } : prev))
                    }
                  />
                </FormField>

                <div
                  className={cn(
                    'flex flex-wrap items-center gap-2 border-t border-hairline pt-3',
                    editing.id ? 'justify-between' : 'justify-end',
                  )}
                >
                  {editing.id ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => onDelete(editing.id as string)}
                    >
                      Delete
                    </Button>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={requestClose}>
                      Cancel
                    </Button>
                    {/* Left enabled with a field empty: pressing it names the missing
                    one, where a disabled button leaves the user hunting. */}
                    <Button type="submit" size="sm">
                      Save
                    </Button>
                  </div>
                </div>

                {/* Was "saved snippets live in this tab only — a reload puts
                    the seeded set back", written when they did. They are
                    records in the store now and a reload brings back what you
                    wrote, so the line that is worth the space is the one about
                    where they are usable. */}
                <p className="text-xs text-text-3">
                  Saved to the database in this browser — it is here when you come back.
                </p>
              </form>
            )

            return full ? (
              <FullScreenDialog
                open
                onOpenChange={(next) => setFullText(next)}
                title={editing.title.trim() || 'New snippet'}
                description="Editing the snippet full screen. Press Escape to go back."
              >
                {form}
              </FullScreenDialog>
            ) : (
              <Panel className="flex min-w-0 flex-1 basis-[380px] flex-col">{form}</Panel>
            )
          })()
        : null}

      {/* The one confirmation left in the Vault, and the only one the Delete law
          allows: unsaved paragraphs are the single thing here that no undo can
          bring back, because they were never written anywhere. */}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Discard unsaved changes?"
        description={`"${editing?.title.trim() || 'Untitled snippet'}" has edits that have not been saved. Leaving now throws them away, and that cannot be undone.`}
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          if (pending?.kind === 'open') openEditor(pending.snippet)
          else closeEditor()
          setPending(null)
        }}
      />
    </div>
  )
}
