import { useState } from 'react'
import { Link } from 'react-router'
import { FileText, Loader2, Trash2, Wand2 } from 'lucide-react'
import { Panel } from '@/components/common/Panel'
import { MenuItem, RowMenu, menuItemClass } from '@/components/common/RowMenu'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SnippetPreviewDialog } from '@/components/vault/SnippetPreviewDialog'
import type { PreviewSnippet } from '@/components/vault/SnippetPreviewDialog'
import { supersededToast } from '@jojo/service/react/undo'
import type { TailorCandidate } from '@jojo/service/core/tailoring'
import { useTailoring } from '@/lib/tailor-agent'
import type { TailoredSnippet } from '@/lib/tailor-agent'
import { settingsPath, vaultPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

/**
 * The person's own documents, rewritten for this posting.
 *
 * Directly under "How you fit", because it is that card's next step: a person
 * who has just read what to lead with asks to have it led with. Choosing a
 * document — the CV, a statement, the cover letter — sends it, the posting, the
 * requirements already read off the posting and the fit verdict to the model,
 * and what comes back is saved as a SNIPPET filed under this application, with
 * the changes marked so the person reads the changes rather than the page.
 *
 * ## This file is the drawing
 *
 * Everything above it — which documents are on offer, what a stored tailored
 * snippet is, the run itself — is `kg/react/use-tailoring.ts`,
 * `kg/react/use-tailor.ts` and the pure modules under them, shared with the
 * phone. The panel draws a chooser, a progress line, and a list.
 *
 * ## Cards here, words in a modal
 *
 * Each tailored document is a card that says what it IS — which document it
 * came from, which model wrote it, when — and nothing of what it says. The
 * first version printed the body under every card, and a record with three
 * tailored documents became a wall of prose with the next section half a
 * screen below; a CV is pages, and pages do not belong in a panel that sits
 * between the dates and the notes. Preview opens it over the record, the way
 * `FilePreviewDialog` opens a filed document, and closing puts the record back
 * exactly as it was.
 *
 * ## No file is written
 *
 * The result is text. jojo does not produce a PDF or edit a DOCX, and the
 * preview says so by offering Copy: the person pastes the tailored section
 * into their own document, which is what they were going to do anyway. Copy
 * strips the marks.
 *
 * ## The three ways this has nothing to offer, and why each is said differently
 *
 *   - No posting behind the record. Nothing to tailor FOR.
 *   - No model connected. Settings.
 *   - No documents in the Vault with bytes behind them. The Vault.
 *
 * None of them hides what has already been written: a tailored letter is
 * readable with no model connected, which is the point of having saved it.
 */

export function TailoredPanel({ applicationId }: { applicationId: string }) {
  const t = useTailoring(applicationId)
  const { toast } = useToast()
  const [choosing, setChoosing] = useState(false)
  /*
   * One at a time, and held by id rather than by value: the snippet is read
   * from the graph on every render, so holding the object would show a stale
   * body for as long as the dialog stayed open after an edit in the Vault.
   */
  const [previewing, setPreviewing] = useState<string | null>(null)
  const preview = t.tailored.find((s) => s.id === previewing) ?? null

  /*
   * Queued, not awaited. The work belongs to the registry above the router —
   * see `kg/react/jobs.ts` — so this returns at once and the card becomes a
   * view of a job that outlives it. What used to be a toast here is raised by
   * the provider when the job settles, wherever the person has got to by then.
   */
  const begin = (candidate: TailorCandidate) => {
    setChoosing(false)
    t.start(candidate)
  }

  const busy = t.running !== null

  return (
    <Panel aria-labelledby={`tailored-${applicationId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`tailored-${applicationId}`} className="flex items-center gap-2 font-medium">
          <Wand2 aria-hidden className="size-4 text-muted-foreground" />
          Tailored materials
        </h2>
        {/* The chooser IS the action: there is no "Tailor" without saying
            which document, so the button opens the list rather than doing
            anything, and the list's rows do the work. */}
        {t.blocked === null && t.candidates.length > 0 && !busy && (
          <Popover open={choosing} onOpenChange={setChoosing}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                <Wand2 aria-hidden className="size-3.5" strokeWidth={1.8} />
                Tailor a document
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 gap-1 p-1.5">
              <p className="px-1.5 pt-1 pb-1.5 text-xs text-text-3">
                Rewritten for this posting, with the changes marked. Takes a minute or two on a
                local model.
              </p>
              {t.candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cn(menuItemClass, 'flex-col items-start gap-0')}
                  onClick={() => {
                    begin(c)
                  }}
                >
                  <span className="text-text-1">
                    {c.label.charAt(0).toUpperCase() + c.label.slice(1)}
                    {c.already && <span className="ml-1.5 text-text-3">· tailored before</span>}
                  </span>
                  <span className="truncate text-text-3">{c.name}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* ------------------------ nothing to offer ------------------------ */}
      {t.blocked === 'no-posting' && (
        <p className="mt-3 text-sm text-muted-foreground">
          There is no saved posting behind this application, so there is nothing to tailor your
          documents for. Add the application from its link, or capture the listing, and this offers
          to.
        </p>
      )}
      {t.blocked === 'no-model' && (
        <p className="mt-3 text-sm text-muted-foreground">
          Tailoring a document needs a model.{' '}
          <Link className="underline underline-offset-2" to={settingsPath()}>
            Connect one in Settings
          </Link>
          .
        </p>
      )}
      {t.blocked === 'no-documents' && (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing to tailor yet. Put your CV, statements or a cover letter in{' '}
          <Link className="underline underline-offset-2" to={vaultPath({ tool: 'files' })}>
            the Vault
          </Link>{' '}
          and they appear here.
        </p>
      )}

      {/* ---------------------------- working ----------------------------- */}
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          {/* The job's own step, so this line is the same on every screen the
              person can be looking at — and still here when they come back.
              'Queued' rather than a spinner with no words for a job waiting
              behind another: one model answers one question at a time. */}
          <span className="truncate">
            {t.running?.state === 'queued' ? 'Queued' : (t.running?.step ?? 'Working')}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={t.cancel}>
            Cancel
          </Button>
        </p>
      )}

      {t.error !== null && !busy && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {t.error}
        </p>
      )}

      {/* --------------------------- the results --------------------------- */}
      {t.tailored.length === 0 &&
        t.blocked === null &&
        t.candidates.length > 0 &&
        !busy &&
        t.error === null && (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing tailored yet. Choose a document above and jojo writes a version for this
            posting, with what it changed marked.
          </p>
        )}

      {t.tailored.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {t.tailored.map((s) => (
            <TailoredCard
              key={s.id}
              snippet={s}
              onPreview={() => setPreviewing(s.id)}
              onDelete={() => {
                const gone = t.remove(s.id)
                if (!gone) return
                const { result, restore } = gone
                toast({
                  title: result.ok ? `${s.title} deleted` : 'That did not delete',
                  ...(result.ok
                    ? {
                        description: 'Gone from this application and from the Vault.',
                        tone: 'danger' as const,
                        ...(restore
                          ? {
                              action: {
                                label: 'Undo',
                                onClick: () => {
                                  const done = restore()
                                  if (done.superseded.length > 0) toast(supersededToast(done))
                                },
                              },
                            }
                          : {}),
                      }
                    : { description: result.errors[0]?.message ?? '', tone: 'danger' as const }),
                })
              }}
            />
          ))}
        </ul>
      )}

      <SnippetPreviewDialog
        snippet={preview && asPreview(preview)}
        onClose={() => setPreviewing(null)}
      />
    </Panel>
  )
}

/** What the dialog needs, out of what the card has. */
const asPreview = (s: TailoredSnippet): PreviewSnippet => ({
  id: s.id,
  title: s.title,
  tag: s.tag,
  body: s.body,
  subtitle: `${s.tag} · from ${s.from} · ${s.model}${s.when ? ` · ${s.when}` : ''}`,
  // Everything this panel lists was written by a model, by construction:
  // `tailoredFor` filters on the record's own `tailored` stamp.
  marked: true,
})

function TailoredCard({
  snippet: s,
  onPreview,
  onDelete,
}: {
  snippet: TailoredSnippet
  onPreview: () => void
  onDelete: () => void
}) {
  return (
    <li className="flex min-w-0 items-start gap-2 rounded-lg border border-hairline p-3">
      <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {/* The card is the button. A title that only looked clickable was the
            defect `FileRow` records against its own name field, and Preview is
            what somebody wants from every part of this card. */}
        <button
          type="button"
          onClick={onPreview}
          className="block max-w-full cursor-pointer truncate text-left font-medium text-text-1 underline-offset-2 transition-colors hover:text-accent hover:underline"
        >
          {s.title}
        </button>
        <p className="truncate text-xs text-text-3">
          {s.tag} · from {s.from}
        </p>
        <p className="truncate text-xs text-text-3">
          {s.model}
          {s.when && ` · ${s.when}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onPreview} aria-label={`Preview ${s.title}`}>
          Preview
        </Button>
        <RowMenu name={s.title}>
          <Link
            to={vaultPath({ tool: 'snippets', focus: s.id })}
            className={menuItemClass}
            role="menuitem"
          >
            Open in the Vault
          </Link>
          <MenuItem icon={Trash2} danger onSelect={onDelete}>
            Delete
          </MenuItem>
        </RowMenu>
      </div>
    </li>
  )
}
