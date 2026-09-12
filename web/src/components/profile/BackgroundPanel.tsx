import { useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { ChevronDown, FileText, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { EmptyState } from '@/components/common/EmptyState'
import { Field, TextareaField } from '@/components/common/Field'
import { menuItemClass } from '@/components/common/RowMenu'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  addEntryFrom,
  draftOf,
  draftProblems,
  emptyDraft,
  updateFrom,
} from '@jojo/service/core/background-form'
import type { BackgroundDraft } from '@jojo/service/core/background-form'
import { BACKGROUND_LABEL, BACKGROUND_ORDER } from '@jojo/service/core/model'
import type { Background, BackgroundKind } from '@jojo/service/core/model'
import { readableDocuments } from '@jojo/service/core/twin'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { requestProfileRead } from '@jojo/service/react/profile-read-request'
import { useRun } from '@jojo/service/react/use-tool'
import { useToast } from '@/lib/toast-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { cn } from '@/lib/utils'

/**
 * What jojo knows about the person, grouped and listed.
 *
 * ## Why this had to exist
 *
 * The graph could hold thirty facts about somebody and there was nowhere to see
 * them. They were shown once, in the review list at import, and then they
 * existed only as an input to a fit score — which is the shape of a feature
 * people stop trusting: a number moves and there is no way to find out what
 * moved it.
 *
 * It also has to exist for the entries to be *correctable*. Extraction is a
 * model reading a document, and the reading is sometimes wrong; a wrong claim
 * about somebody's own career, in their own records, that they cannot delete is
 * worse than no record at all.
 *
 * ## Grouped by kind, ordered as a CV is
 *
 * Not one flat list ordered by date. A CV puts education before employment
 * before publications for a reason — that is the order a reader wants them —
 * and `BACKGROUND_ORDER` in core is that order. It lives there rather than here
 * because the phone renders the same list, and two copies is two chances for a
 * kind added to the vocabulary to be shown by one platform and silently dropped
 * by the other.
 *
 * Only the kinds with something in them appear, on the same principle
 * `memory.overview` follows: a person shown fourteen headings of which eleven
 * are empty spends their attention on the eleven.
 */

function Entry({
  entry,
  onEdit,
  onDelete,
}: {
  entry: Background
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const bullets = entry.highlights ?? []

  return (
    <li className="group border-t border-hairline py-2 first:border-t-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">{entry.title}</span>
            {entry.where !== undefined && <span className="text-text-2"> · {entry.where}</span>}
            {entry.period !== undefined && <span className="text-text-3"> · {entry.period}</span>}
          </p>
          {entry.detail !== undefined && (
            <p className="mt-0.5 text-sm text-text-2">{entry.detail}</p>
          )}

          {bullets.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="mt-1 inline-flex items-center gap-1 text-xs text-text-3 hover:text-text-2"
              >
                <ChevronDown
                  aria-hidden
                  className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                />
                {bullets.length === 1 ? '1 detail' : `${String(bullets.length)} details`}
              </button>
              {open && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-text-2">
                  {bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Where it came from. An entry a model read out of a document is a
              different kind of claim from one somebody typed, and a person
              checking a surprising line needs to know which it is. */}
          {entry.source !== undefined && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-text-3">
              <FileText aria-hidden className="size-3" />
              read from a document
            </p>
          )}
        </div>

        {/* Edit and remove, revealed together. Correcting a wrong reading is
            the commoner act of the two — a year, a misfiled kind, a "Where" that
            named the department rather than the university — and it used to
            take a delete and a retype. */}
        <div className="flex shrink-0 items-start opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Button size="sm" variant="ghost" aria-label={`Edit ${entry.title}`} onClick={onEdit}>
            <Pencil aria-hidden className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Remove ${entry.title}`} onClick={onDelete}>
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  )
}

/**
 * One form for adding an entry and for editing one in place.
 *
 * The three decisions — what a blank box means, what changed, what to refuse
 * before the tool sees it — are `core/background-form.ts`, shared with the
 * phone; this draws the boxes. Editing shows every field the record has,
 * including the bullets under a job as one line each and the year that the
 * fit score sorts on, because a form that hid a field is a field nobody can
 * correct.
 *
 * Nothing is written until Save, and Save is disabled until something has
 * changed: a Save that wrote nothing would raise an undo toast for nothing.
 * Escape backs out, as every inline editor here does, and ⌘/Ctrl+Enter
 * submits from inside a textarea, where Enter has to mean a new line.
 */
function EntryForm({
  initial,
  onDone,
}: {
  /** Absent for a new entry. */
  initial?: Background | undefined
  onDone: () => void
}) {
  const run = useRun()
  const { toast } = useToast()
  const [draft, setDraft] = useState<BackgroundDraft>(() =>
    initial === undefined ? emptyDraft() : draftOf(initial),
  )
  const [tried, setTried] = useState(false)
  const problems = draftProblems(draft)
  const patch = initial === undefined ? null : updateFrom(initial, draft)
  const blocked = Object.keys(problems).length > 0 || (initial !== undefined && patch === null)
  const set = (key: keyof BackgroundDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    setTried(true)
    if (Object.keys(problems).length > 0) return

    if (initial === undefined) {
      const entry = addEntryFrom(draft)
      const result = run('profile.background.add', { background: [entry] })
      toast({
        title: result.ok ? `${entry.title} added` : 'That did not save',
        ...(result.ok
          ? { action: result.undo ? { label: 'Undo', onClick: result.undo } : undefined }
          : { description: result.errors[0]?.message, tone: 'danger' as const }),
      })
      if (result.ok) onDone()
      return
    }

    if (patch === null) {
      onDone()
      return
    }
    const result = run('profile.background.update', { id: initial.id, ...patch })
    toast({
      title: result.ok ? `${draft.title.trim() || initial.title} updated` : 'That did not save',
      ...(result.ok
        ? { action: result.undo ? { label: 'Undo', onClick: result.undo } : undefined }
        : { description: result.errors[0]?.message, tone: 'danger' as const }),
    })
    if (result.ok) onDone()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onDone()
      return
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  const editing = initial !== undefined
  return (
    <form
      className="space-y-2 rounded-lg border border-hairline p-3"
      aria-label={editing ? `Edit ${initial.title}` : 'Add an entry'}
      onSubmit={submit}
      onKeyDown={onKeyDown}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,11rem)_1fr]">
        <label className="flex flex-col gap-1 text-xs text-text-2">
          Kind
          <select
            className="bg-surface h-9 rounded-md border border-hairline px-2 text-sm text-text-1"
            value={draft.kind}
            onChange={(e) => set('kind')(e.target.value as BackgroundKind)}
          >
            {BACKGROUND_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {BACKGROUND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Title"
          required
          autoFocus
          placeholder="What it was"
          value={draft.title}
          error={tried ? problems.title : undefined}
          onChange={(e) => set('title')(e.target.value)}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_6rem]">
        <Field
          label="Where"
          placeholder="Optional"
          value={draft.where}
          onChange={(e) => set('where')(e.target.value)}
        />
        <Field
          label="When"
          placeholder="As written — “2021–2024”"
          value={draft.period}
          onChange={(e) => set('period')(e.target.value)}
        />
        <Field
          label="Year"
          inputMode="numeric"
          maxLength={4}
          placeholder="2024"
          value={draft.year}
          error={tried ? problems.year : undefined}
          onChange={(e) => set('year')(e.target.value)}
        />
      </div>
      <TextareaField
        label="Detail"
        rows={2}
        placeholder="Anything worth weighing a posting against (optional)"
        value={draft.detail}
        onChange={(e) => set('detail')(e.target.value)}
      />
      <TextareaField
        label="Highlights"
        hint="One per line — what was built, shipped, taught or found."
        rows={
          editing && draft.highlights !== ''
            ? Math.min(6, draft.highlights.split('\n').length + 1)
            : 2
        }
        value={draft.highlights}
        onChange={(e) => set('highlights')(e.target.value)}
      />
      <div className="flex items-center justify-end gap-2">
        {editing && initial.source !== undefined && (
          <p className="mr-auto flex items-center gap-1 text-xs text-text-3">
            <FileText aria-hidden className="size-3" />
            read from a document — your edit is kept over the reading
          </p>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={blocked}>
          {editing ? 'Save changes' : 'Add'}
        </Button>
      </div>
    </form>
  )
}

export function BackgroundPanel() {
  const graph = useGraph()
  const { projections } = useKg()
  const run = useRun()
  const { toast } = useToast()

  const all = projections.background(graph)
  const { settings } = useModelSettings()
  const configured = settings.model.trim() !== ''

  const groups = useMemo(() => {
    const by = new Map<BackgroundKind, Background[]>()
    for (const entry of all) {
      const held = by.get(entry.kind)
      if (held) held.push(entry)
      else by.set(entry.kind, [entry])
    }
    return BACKGROUND_ORDER.flatMap((kind) => {
      const rows = by.get(kind)
      return rows === undefined ? [] : [{ kind, rows }]
    })
  }, [all])

  /*
   * Adding a fact by hand, and now correcting one in place.
   *
   * The only writer was the CV reader, so somebody with no CV to hand — or with
   * a fact no document of theirs mentions, which is most volunteering, most
   * outreach and every award announced in an email — could not record it. And
   * a fact read WRONGLY — a year, a kind, a "Where" naming the department —
   * could only be deleted and retyped, which for an entry with six bullets
   * under it meant nobody did. `EntryForm` is both, and the row being edited
   * becomes the form so the correction is made where the mistake is read.
   *
   * One thing open at a time: an add and an edit, or two edits, on one page
   * would be two half-typed forms racing for the same Save.
   */
  const [open, setOpen] = useState<'add' | { edit: string } | null>(null)
  const editingId = open !== null && typeof open === 'object' ? open.edit : null

  const remove = (entry: Background) => {
    const result = run('profile.background.delete', { id: entry.id })
    toast({
      title: result.ok ? `${entry.title} removed` : 'That did not save',
      ...(result.ok
        ? { action: result.undo ? { label: 'Undo', onClick: result.undo } : undefined }
        : { description: result.errors[0]?.message, tone: 'danger' as const }),
    })
  }

  return (
    <Panel>
      <PanelTitle
        hint={
          all.length === 0
            ? undefined
            : `${String(all.length)} recorded · what a posting is weighed against`
        }
      >
        Your background
      </PanelTitle>

      {open === 'add' ? (
        <div className="mb-4">
          <EntryForm onDone={() => setOpen(null)} />
        </div>
      ) : (
        <div className="mb-3 flex justify-end gap-2">
          <ReadDocumentMenu configured={configured} />
          <Button size="sm" variant="outline" onClick={() => setOpen('add')}>
            Add an entry
          </Button>
        </div>
      )}

      {all.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nothing recorded yet"
          /*
           * Branched on whether a model is configured, because the unbranched
           * sentence was a promise the app could not keep: `ProfileUpdateOffer`
           * renders nothing without a model, so somebody could upload a CV six
           * inches below a line saying jojo would offer to read it, and wait
           * forever. An empty state that names the missing piece is the whole
           * job of an empty state.
           */
          description={
            // Both halves now end with the manual route, because the empty
            // state used to describe the ONLY route and it needed a document
            // and, for one of the two, a model as well.
            configured
              ? 'Put your CV, a research or teaching statement in the Vault and jojo will offer to read it — what it finds is shown to you before anything is saved. Or add an entry by hand.'
              : 'Reading a document needs a model. Connect one in Settings, then put your CV or a statement in the Vault and jojo will offer to read it. You can add entries by hand without one.'
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map(({ kind, rows }) => (
            <section key={kind}>
              <h3 className="mb-1 text-xs font-medium tracking-wide text-text-3 uppercase">
                {BACKGROUND_LABEL[kind]}
              </h3>
              <ul>
                {rows.map((entry) =>
                  entry.id === editingId ? (
                    <li key={entry.id} className="border-t border-hairline py-2 first:border-t-0">
                      <EntryForm initial={entry} onDone={() => setOpen(null)} />
                    </li>
                  ) : (
                    <Entry
                      key={entry.id}
                      entry={entry}
                      onEdit={() => setOpen({ edit: entry.id })}
                      onDelete={() => remove(entry)}
                    />
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  )
}

/**
 * Pick a document in the Vault and have it read into the profile, now.
 *
 * The offer banner asks about documents on its own terms and remembers what
 * was declined; this is the other direction. It exists because the fit panel
 * on an application said "put your CV in the Vault and say yes when it offers
 * to read it" to people whose CV was already there — the offer had been
 * dismissed once, or never fired — and nothing anywhere let them say "that
 * one, read it".
 *
 * Choosing here opens the same banner above the page, with the same review
 * list, and nothing is written until they press Add: the request only decides
 * WHICH document the question is about. See `profile-read-request.ts`.
 *
 * Documents already read are listed and disabled rather than hidden, so
 * somebody looking for their CV can see that it was read rather than read it
 * again and file every fact twice.
 */
function ReadDocumentMenu({ configured }: { configured: boolean }) {
  const graph = useGraph()
  const blobs = useVaultBlobs()
  const [open, setOpen] = useState(false)
  // `blobs` is in the list for its revision: a document dropped on the Vault a
  // moment ago has bytes now, and this list has to say so.
  const documents = useMemo(() => readableDocuments(graph, (f) => blobs.has(f.id)), [graph, blobs])
  const unread = documents.filter((d) => !d.read)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={!configured}
          title={
            configured ? undefined : 'Reading a document needs a model. Connect one in Settings.'
          }
        >
          <Sparkles className="size-3.5" strokeWidth={2} aria-hidden />
          Read a document
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-1 p-1.5">
        {documents.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-text-3">
            Nothing in the Vault can be read yet. Drop your CV or a statement in and it appears
            here.
          </p>
        ) : (
          <>
            {unread.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-text-3">
                Everything readable in the Vault has been read.
              </p>
            )}
            {documents.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={d.read}
                className={cn(menuItemClass, 'w-full justify-between', d.read && 'opacity-50')}
                onClick={() => {
                  setOpen(false)
                  requestProfileRead({ fileId: d.id, name: d.name })
                  // The banner is above the route; on a long profile page it is
                  // off screen, and a question nobody can see is not asked.
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              >
                <span className="min-w-0 truncate">{d.name}</span>
                {d.read && <span className="ml-2 shrink-0 text-xs text-text-3">read</span>}
              </button>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
