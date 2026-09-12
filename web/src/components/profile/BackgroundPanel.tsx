import { useMemo, useState } from 'react'
import { ChevronDown, FileText, Sparkles, Trash2 } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { EmptyState } from '@/components/common/EmptyState'
import { menuItemClass } from '@/components/common/RowMenu'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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

function Entry({ entry, onDelete }: { entry: Background; onDelete: () => void }) {
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

        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove ${entry.title}`}
          className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={onDelete}
        >
          <Trash2 aria-hidden className="size-4" />
        </Button>
      </div>
    </li>
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
   * Adding a fact by hand, which had no route at all.
   *
   * The only writer was the CV reader, so somebody with no CV to hand — or with
   * a fact no document of theirs mentions, which is most volunteering, most
   * outreach and every award announced in an email — could not record it. The
   * panel offered a delete and no add, which reads as "this is a view of a
   * document" rather than "this is your profile".
   *
   * The form asks for the two fields the tool requires and the three it does
   * most with. Highlights and `source` are deliberately not here: highlights
   * are what a CV's bullet points become and typing them one at a time is a
   * worse way to spend a minute than pasting the CV, and `source` names a
   * document this entry did NOT come from.
   */
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({
    kind: 'employment' as BackgroundKind,
    title: '',
    where: '',
    period: '',
    detail: '',
  })
  const reset = () => {
    setDraft({ kind: 'employment', title: '', where: '', period: '', detail: '' })
    setAdding(false)
  }

  const add = () => {
    const title = draft.title.trim()
    if (title === '') return
    const result = run('profile.background.add', {
      background: [
        {
          kind: draft.kind,
          title,
          // `exactOptionalPropertyTypes`: an empty box is an ABSENT field, not
          // an empty string. Sending '' would put a blank "Where" on the row.
          ...(draft.where.trim() === '' ? {} : { where: draft.where.trim() }),
          ...(draft.period.trim() === '' ? {} : { period: draft.period.trim() }),
          ...(draft.detail.trim() === '' ? {} : { detail: draft.detail.trim() }),
        },
      ],
    })
    toast({
      title: result.ok ? `${title} added` : 'That did not save',
      ...(result.ok
        ? { action: result.undo ? { label: 'Undo', onClick: result.undo } : undefined }
        : { description: result.errors[0]?.message, tone: 'danger' as const }),
    })
    if (result.ok) reset()
  }

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

      {adding ? (
        <form
          className="mb-4 space-y-2 rounded-lg border border-hairline p-3"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <div className="flex gap-2">
            <select
              aria-label="Kind"
              className="bg-surface rounded-md border border-hairline px-2 py-1.5 text-sm"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as BackgroundKind })}
            >
              {BACKGROUND_ORDER.map((kind) => (
                <option key={kind} value={kind}>
                  {BACKGROUND_LABEL[kind]}
                </option>
              ))}
            </select>
            <input
              aria-label="Title"
              required
              autoFocus
              placeholder="What it was"
              className="bg-surface flex-1 rounded-md border border-hairline px-2 py-1.5 text-sm"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <input
              aria-label="Where"
              placeholder="Where (optional)"
              className="bg-surface flex-1 rounded-md border border-hairline px-2 py-1.5 text-sm"
              value={draft.where}
              onChange={(e) => setDraft({ ...draft, where: e.target.value })}
            />
            <input
              aria-label="When"
              placeholder="When — “2021–2024” (optional)"
              className="bg-surface flex-1 rounded-md border border-hairline px-2 py-1.5 text-sm"
              value={draft.period}
              onChange={(e) => setDraft({ ...draft, period: e.target.value })}
            />
          </div>
          <textarea
            aria-label="Detail"
            rows={2}
            placeholder="Anything worth weighing a posting against (optional)"
            className="bg-surface w-full rounded-md border border-hairline px-2 py-1.5 text-sm"
            value={draft.detail}
            onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={draft.title.trim() === ''}>
              Add
            </Button>
          </div>
        </form>
      ) : (
        <div className="mb-3 flex justify-end gap-2">
          <ReadDocumentMenu configured={configured} />
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
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
                {rows.map((entry) => (
                  <Entry key={entry.id} entry={entry} onDelete={() => remove(entry)} />
                ))}
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
