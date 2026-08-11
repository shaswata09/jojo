import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Quote } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { VaultSearch, VaultToolbar, matchesQuery } from '@/components/vault/VaultToolbar'
import { snippetsEmptyState } from '@/components/vault/snippets/empty-state'
import { keywordKey } from '@/components/vault/snippets/model'
import type { Clean, Draft, Pending } from '@/components/vault/snippets/model'
import { SnippetCard } from '@/components/vault/snippets/SnippetCard'
import { SnippetEditor } from '@/components/vault/snippets/SnippetEditor'
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

  const empty = snippetsEmptyState({
    total: snippets.length,
    query,
    tagFilter,
    selectedLabels,
    onNew: () => requestOpen(),
    onClearQuery: () => setQuery(''),
    onClearTag: () => setTagFilter('all'),
    onClearKeywords: clearSelected,
  })

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
            {visible.map((s) => (
              <SnippetCard
                key={s.id}
                snippet={s}
                cardRef={s.id === focus ? focusedCard : undefined}
                focused={s.id === focus}
                active={editing?.id === s.id}
                copied={copiedId === s.id}
                failed={failed}
                onOpen={() => requestOpen(s)}
                onCopy={() => copy(s.id, s.body)}
                onDuplicate={onDuplicate}
                onMove={onMove}
                onDelete={onDelete}
              />
            ))}
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
        <SnippetEditor
          editing={editing}
          setEditing={setEditing}
          dirty={dirty}
          full={full}
          setFullText={setFullText}
          titleError={titleError}
          bodyError={bodyError}
          save={save}
          requestClose={requestClose}
          onDelete={onDelete}
        />
      ) : null}

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
