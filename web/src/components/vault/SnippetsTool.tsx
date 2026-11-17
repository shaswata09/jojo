import { useEffect, useMemo, useRef, useState } from 'react'
import { stripMarks } from '@jojo/service/core/marks'
import { useApplications } from '@jojo/service/react/use-applications'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import type { NodeId } from '@jojo/service/core/model'
import type { FormEvent } from 'react'
import { Plus, Quote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BucketFilter } from '@/components/common/BucketFilter'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { emptyStateFor } from '@/components/vault/empty-state'
import { matchesQuery } from '@/components/vault/search'
import { VaultSearch, VaultToolbar } from '@/components/vault/VaultToolbar'
import { keywordKey } from '@/components/vault/snippets/model'
import type { Clean, Draft, Pending } from '@/components/vault/snippets/model'
import { SnippetCard } from '@/components/vault/snippets/SnippetCard'
import { SnippetEditor } from '@/components/vault/snippets/SnippetEditor'
import { SNIPPET_TAGS } from '@/data/vault'
import type { Snippet, SnippetTag } from '@/data/vault'
import { useVault } from '@jojo/service/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { htmlFromNote, noteFromRuns } from '@/lib/note-html'
import { rawRunsFromHtml } from '@/lib/note-runs'
import { encodeFormat } from '@jojo/service/core/note-format'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { cn } from '@/lib/utils'
import { report } from '@/lib/analytics'
import { announceRefusal, refusalToast } from '@/components/common/write-result'
import { useUndoable } from '@/lib/undo'

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
  const { t } = useTranslation('vault')
  const graph = useGraph()
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
  /** Which record the panel is open on, for an Undo fired from an older toast. */
  const openId = useRef<string | null>(null)
  useEffect(() => {
    openId.current = editing?.id ?? null
  }, [editing])
  const undoable = useUndoable()
  const { repo, projections } = useKg()

  const {
    matches,
    selected: selectedLabels,
    clearSelected,
    labelIdsOf,
    setRecord,
    removeRecord,
  } = useLabels()
  const { snippets, addSnippet, duplicateSnippet, updateSnippet, removeSnippet } = useVault()
  // Named for the card's link; the editor's picker reads the list itself.
  const { byId } = useApplications()
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

  /**
   * What Save would write: the text, and the formatting over it.
   *
   * One conversion for both, because they have to agree — the offsets are into
   * this exact string, and computing them from a second parse of the same HTML
   * is how the two drift. `noteFromRuns` is the note editor's own converter;
   * a snippet is the same problem and gets the same answer rather than a second
   * one.
   */
  const saving = useMemo(
    () =>
      editing
        ? noteFromRuns(rawRunsFromHtml(editing.html))
        : { text: '', format: undefined, dropped: { colour: 0, size: 0, overflow: 0 } },
    [editing],
  )
  const body = saving.text
  const format = encodeFormat(saving.format)

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
      keywordKey(editing.keywords) !== clean.keywords ||
      // Order-insensitive: picking Rice then Baylor is the same filing as
      // Baylor then Rice, and a dirty check that disagreed would warn about a
      // change nobody made.
      keywordKey(editing.applicationIds) !== keywordKey(clean.applicationIds))

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
          // Off the node, not the projection: the spans are dropped there on
          // purpose, the same way an application's are.
          html: htmlFromNote(s.body, graph.node(s.id as NodeId, 'snippet')?.props.bodyFormat),
          applicationIds: s.applicationIds,
          keywords: labelIdsOf(s.id),
        }
      : {
          id: null,
          title: '',
          // A new snippet takes the kind being looked at, so writing one while
          // filtered does not file it somewhere the list cannot show it.
          tag: tagFilter === 'all' ? 'Cover letter' : tagFilter,
          html: '',
          applicationIds: [],
          keywords: [],
        }
    setEditing(draft)
    // The baseline is the round trip, not the stored body. A body with a
    // trailing space on a line comes back one character shorter, and comparing
    // against the original would mark an editor nobody has typed in as dirty.
    setClean({
      title: draft.title,
      tag: draft.tag,
      body: noteFromRuns(rawRunsFromHtml(draft.html)).text,
      keywords: keywordKey(draft.keywords),
      applicationIds: draft.applicationIds,
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

  const titleError = submitted && !editing?.title.trim() ? t('snippets.errors.title') : undefined
  const bodyError =
    submitted && editing?.title.trim() && !body ? t('snippets.errors.body') : undefined

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    setSubmitted(true)

    const title = editing.title.trim()
    if (!title || !body) return

    const chosen = editing.keywords

    if (editing.id) {
      const id = editing.id
      // Read before the write: the journal puts these back, and the label
      // index this reads from has not re-rendered by the time Undo runs.
      const beforeKeywords = labelIdsOf(id)

      // The journal's Undo, not a hand-built patch. Handing `updateSnippet` the
      // projection back carried no `bodyFormat`, and an omitted format means
      // "keep what is stored" — so every mark the save added survived Undo.
      // The write and the keywords are one burst, so one Undo takes both back.
      const { value: result, restore } = undoable(() => {
        const written = updateSnippet(
          id,
          { title, tag: editing.tag, body, applicationIds: editing.applicationIds },
          // '' rather than omitted when there is none: absent means "keep what
          // is stored", and clearing every mark off a snippet has to be savable.
          format ?? '',
        )
        if (refusalToast(written) === null) commitKeywords(id, chosen)
        return written
      })
      if (announceRefusal(result, toast)) return
      // The draft takes the trimmed title too, or the dirty check compares
      // 'Short bio ' against the 'Short bio' that was stored and the panel keeps
      // claiming unsaved changes forever.
      setEditing((prev) => (prev ? { ...prev, title } : prev))
      setClean({
        title,
        tag: editing.tag,
        body,
        keywords: keywordKey(chosen),
        applicationIds: editing.applicationIds,
      })
      toast({
        title: t('common.saved', { title }),
        description: t('snippets.toast.filed', { tag: editing.tag }),
        // A save that committed nothing offers no Undo rather than a dead button.
        ...(restore
          ? {
              action: {
                label: t('common.undo'),
                onClick: () => {
                  restore()
                  // The panel is very likely still open on this record, so it
                  // is re-seeded from what the store now holds — text, marks,
                  // filing and keywords alike. Seeding it from a copy taken
                  // before the write left the new filing in the picker and the
                  // new marks in the editor after the store had reverted.
                  const snapshot = repo.getSnapshot()
                  const stored = projections.snippets(snapshot).find((s) => s.id === id)
                  if (!stored) return
                  const keywords = beforeKeywords
                  const html = htmlFromNote(
                    stored.body,
                    snapshot.node(id as NodeId, 'snippet')?.props.bodyFormat,
                  )
                  setEditing((prev) =>
                    prev?.id === id
                      ? {
                          ...prev,
                          title: stored.title,
                          tag: stored.tag,
                          html,
                          applicationIds: stored.applicationIds,
                          keywords,
                        }
                      : prev,
                  )
                  if (openId.current !== id) return
                  setClean((prev) =>
                    prev
                      ? {
                          title: stored.title,
                          tag: stored.tag,
                          body: noteFromRuns(rawRunsFromHtml(html)).text,
                          keywords: keywordKey(keywords),
                          applicationIds: stored.applicationIds,
                        }
                      : prev,
                  )
                },
              },
            }
          : {}),
      })
      return
    }

    const record = addSnippet({
      title,
      tag: editing.tag,
      body,
      ...(format === undefined ? {} : { format }),
      applicationIds: editing.applicationIds,
    })
    commitKeywords(record.id, chosen)
    report('vault_item_added', { kind: 'snippet' })

    // The editor stays open on the record it just created rather than closing:
    // the first save is usually followed by another edit.
    setEditing({ ...editing, id: record.id, title })
    setClean({
      title,
      tag: editing.tag,
      body,
      keywords: keywordKey(chosen),
      applicationIds: editing.applicationIds,
    })

    // Saved into a list the filters are hiding is the one outcome that looks
    // like a dropped write, so it gets named rather than a bare confirmation.
    const hidden =
      (tagFilter !== 'all' && record.tag !== tagFilter) ||
      (selectedLabels.size > 0 && !chosen.some((id) => selectedLabels.has(id))) ||
      !matchesQuery(query, title, body, record.tag)

    toast({
      title: t('common.saved', { title }),
      description: hidden
        ? t('snippets.toast.filedHidden', { tag: record.tag })
        : t('snippets.toast.filed', { tag: record.tag }),
      action: hidden
        ? {
            label: t('common.showIt'),
            onClick: () => {
              setTagFilter('all')
              setQuery('')
              clearSelected()
            },
          }
        : {
            label: t('common.undo'),
            onClick: () => {
              removeSnippet(record.id)
              removeRecord(record.id)
              closeEditor()
            },
          },
    })
  }

  const onDuplicate = (s: Snippet) => {
    // Through the tool, and in ONE write: a hand-made copy of a tailored
    // document must not keep the model's provenance nor its marks as literal
    // characters, and one press must be one thing to undo.
    const copy = duplicateSnippet(s.id, t('reminders.copyTitle', { title: s.title }))
    const keywords = labelIdsOf(s.id)
    if (keywords.length > 0) setRecord(copy.id, keywords)
    toast({
      title: t('reminders.toast.duplicated', { title: s.title }),
      description: t('snippets.toast.duplicated', { tag: copy.tag }),
      action: {
        label: t('common.undo'),
        onClick: () => {
          removeSnippet(copy.id)
          removeRecord(copy.id)
        },
      },
    })
  }

  const onMove = (s: Snippet, next: SnippetTag) => {
    const before = s.tag
    if (announceRefusal(updateSnippet(s.id, { tag: next }), toast)) return
    if (editing?.id === s.id) setEditing((prev) => (prev ? { ...prev, tag: next } : prev))
    toast({
      title: t('reminders.toast.moved', { title: s.title }),
      description:
        tagFilter !== 'all' && tagFilter !== next
          ? t('snippets.toast.movedOut', { tag: next, filter: tagFilter })
          : t('snippets.toast.moved', { tag: next }),
      action: { label: t('common.undo'), onClick: () => updateSnippet(s.id, { tag: before }) },
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

    const removed = removeSnippet(id)
    if (!removed.ok) {
      toast({
        title: t('common.deleteFailed'),
        description:
          removed.refusal ??
          (doomed
            ? t('snippets.toast.stillThere', { title: doomed.title })
            : t('snippets.toast.stillThereUnnamed')),
        tone: 'danger',
      })
      return
    }
    const { restore } = removed
    removeRecord(id)
    if (editing?.id === id) closeEditor()

    toast({
      title: doomed
        ? t('common.deleted', { title: doomed.title })
        : t('snippets.toast.deletedUnnamed'),
      description: t('snippets.toast.deletedDescription'),
      tone: 'danger',
      action: {
        label: t('common.undo'),
        onClick: () => {
          restore()
          // Guarded: `setRecord` with an empty list files the record as carrying
          // no keywords rather than leaving it unmentioned.
          if (stashed.length > 0) setRecord(id, stashed)
        },
      },
    })
  }

  const empty = emptyStateFor({
    total: snippets.length,
    query,
    filteredByBucket: tagFilter !== 'all',
    filteredByKeyword: selectedLabels.size > 0,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setTagFilter('all'),
    onClearKeywords: clearSelected,
    copy: {
      zero: {
        title: t('snippets.empty.zeroTitle'),
        description: t('snippets.empty.zeroDescription'),
        action: (
          <Button size="sm" onClick={() => requestOpen()}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            {t('snippets.editor.newTitle')}
          </Button>
        ),
      },
      search: (q) => t('snippets.empty.search', { query: q }),
      both: t('snippets.empty.both', { tag: tagFilter }),
      bucket: {
        title: t('snippets.empty.bucketTitle', { tag: tagFilter }),
        description: t('snippets.empty.bucketDescription', { count: snippets.length }),
        clearLabel: t('snippets.empty.showAll'),
      },
      keywords: { title: t('snippets.empty.keywordsTitle') },
    },
  })

  return (
    <div className="flex flex-wrap items-start gap-4 sm:gap-5">
      <Panel className={cn('min-w-0', editing ? 'flex-1 basis-[320px]' : 'w-full')}>
        {snippets.length > 0 ? (
          <VaultToolbar
            filter={
              <BucketFilter
                label={t('snippets.filterLabel')}
                options={SNIPPET_TAGS}
                counts={counts}
                value={tagFilter}
                onChange={setTagFilter}
                total={snippets.length}
              />
            }
            search={
              <VaultSearch
                label={t('snippets.searchLabel')}
                placeholder={t('snippets.searchPlaceholder')}
                value={query}
                onChange={setQuery}
              />
            }
            action={
              <Button size="sm" onClick={() => requestOpen()}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                {t('snippets.editor.newTitle')}
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
                related={s.applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)}
                key={s.id}
                snippet={s}
                cardRef={s.id === focus ? focusedCard : undefined}
                focused={s.id === focus}
                active={editing?.id === s.id}
                copied={copiedId === s.id}
                failed={failed}
                onOpen={() => requestOpen(s)}
                onCopy={() => copy(s.id, s.tailored ? stripMarks(s.body) : s.body)}
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
          {copiedId ? (failed ? t('common.copyBlocked') : t('snippets.copied')) : ''}
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
        title={t('snippets.discard.title')}
        description={t('snippets.discard.description', {
          title: editing?.title.trim() || t('snippets.discard.untitled'),
        })}
        confirmLabel={t('snippets.discard.confirm')}
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
