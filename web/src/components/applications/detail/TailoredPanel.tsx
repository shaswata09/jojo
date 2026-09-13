import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Trash2, Wand2 } from 'lucide-react'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import { Marked, MarksLegend } from '@/components/common/Marked'
import { Panel } from '@/components/common/Panel'
import { MenuItem, RowMenu, menuItemClass } from '@/components/common/RowMenu'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { stripMarks } from '@jojo/service/core/marks'
import { supersededToast } from '@jojo/service/react/undo'
import { TAILOR_STEP_LABEL } from '@jojo/service/react/use-tailor'
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
 * ## No file is written
 *
 * The result is text. jojo does not produce a PDF or edit a DOCX, and this
 * card says so by being a list of snippets with a Copy button: the person
 * pastes the tailored section into their own document, which is what they
 * were going to do anyway. Copy strips the marks.
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

  const begin = async (candidate: TailorCandidate) => {
    setChoosing(false)
    const outcome = await t.start(candidate)
    if (!outcome.ok) return
    toast({
      title: `${outcome.title} saved`,
      description:
        outcome.notes.length > 0
          ? outcome.notes.join(' ')
          : 'Filed under this application, with the changes marked. Copy strips the marks.',
      ...(outcome.restore
        ? {
            action: {
              label: 'Undo',
              onClick: () => {
                const done = outcome.restore?.()
                if (done && done.superseded.length > 0) toast(supersededToast(done))
              },
            },
          }
        : {}),
    })
  }

  const busy = t.step !== null

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
                  onClick={() => void begin(c)}
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
        <div className="mt-3 space-y-2 text-sm">
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            {t.step === null ? '' : TAILOR_STEP_LABEL[t.step]}
            {t.target && <span className="truncate">· {t.target}</span>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={t.cancel}>
              Cancel
            </Button>
          </p>
          {/* The reply as it arrives. Watching a document appear is the
              difference between "it is working" and "it is stuck". */}
          {t.draft !== '' && (
            <div className="max-h-56 overflow-auto rounded-lg border border-hairline bg-well p-3">
              <Marked body={t.draft} />
            </div>
          )}
        </div>
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
        <ul className="mt-3 space-y-3">
          {t.tailored.map((s) => (
            <TailoredRow
              key={s.id}
              snippet={s}
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

      {t.tailored.length > 0 && <MarksLegend className="mt-3" />}
    </Panel>
  )
}

function TailoredRow({ snippet: s, onDelete }: { snippet: TailoredSnippet; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stripMarks(s.body))
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <li className="rounded-lg border border-hairline p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-text-1">{s.title}</p>
          <p className="text-xs text-text-3">
            {s.tag} · from {s.from} · {s.model}
            {s.when && ` · ${s.when}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copy()}
            title="Copy without the marks"
          >
            <CopyFeedback copied={copied} failed={failed} />
          </Button>
          <RowMenu name={s.title}>
            <MenuItem icon={ExternalLink} onSelect={() => setOpen((v) => !v)}>
              {open ? 'Show less' : 'Show all'}
            </MenuItem>
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
      </div>

      {/* Collapsed to a screenful by default: a tailored CV is long, and the
          card is one of six on the page. */}
      <div className={cn('relative mt-2', !open && 'max-h-48 overflow-hidden')}>
        <Marked body={s.body} />
        {!open && (
          <div
            aria-hidden
            className="from-surface pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t to-transparent"
          />
        )}
      </div>
      <button
        type="button"
        className="mt-1.5 flex cursor-pointer items-center gap-1 text-xs text-text-2 hover:text-text-1"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronUp aria-hidden className="size-3.5" />
        ) : (
          <ChevronDown aria-hidden className="size-3.5" />
        )}
        {open ? 'Show less' : 'Show all'}
      </button>
    </li>
  )
}
