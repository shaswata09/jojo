import { Link } from 'react-router'
import { Loader2, RotateCw, Target, Trash2 } from 'lucide-react'
import { Panel } from '@/components/common/Panel'
import { MenuItem, RowMenu } from '@/components/common/RowMenu'
import { Button } from '@/components/ui/button'
import { supersededToast } from '@jojo/service/react/undo'
import { HOW_LABEL } from '@jojo/service/core/posting-source'
import { STALE_NOTE } from '@jojo/service/core/fit-reading'
import { VERDICT_LABEL } from '@jojo/service/core/tailor'
import { useFit } from '@/lib/fit-agent'
import type { FitStep } from '@/lib/fit-agent'
import { useToast } from '@/lib/toast-context'
import { settingsPath, vaultPath } from '@/lib/links'

/**
 * How this application's posting weighs against what the person has done.
 *
 * Three things, in the order somebody wants them the evening they decide
 * whether to apply: a verdict with its reason, what to lead with, and what to
 * be ready to be asked. `core/tailor.ts` computes all three and argues at
 * length that none of them may be a model's prose — every line here names a
 * record or a requirement, and a person can disagree with any of them.
 *
 * ## This file is the drawing, and only the drawing
 *
 * Everything above it — when to read, what a stored reading means, what is
 * worth doubting — is `kg/react/use-fit.ts` and the pure modules under it. It
 * used to be 127 lines of state machine here and the same 127 lines in the
 * phone's copy, with nothing comparing them; see that file for what that cost.
 *
 * ## The four ways this has nothing to say, and why each is said differently
 *
 * A card that renders "not enough information" for all of them is a card that
 * teaches people to stop reading it. They are genuinely different situations
 * with different fixes, and only one of them is about this application:
 *
 *   - No posting behind it. They typed this in, or captured it before jojo kept
 *     pages. Nothing is wrong; there is simply no text to measure against, and
 *     inventing requirements from the role title would produce a score
 *     indistinguishable from a real one.
 *   - No model configured. Settings.
 *   - No background recorded. The Vault and the profile offer — this is the
 *     one that resolves itself the moment somebody reads their CV in.
 *   - The posting was read and states nothing measurable. Rare, and honest.
 *
 * A fifth now: the person cleared the reading. That one is not a gap to be
 * filled, it is an answer, and the card says so rather than offering to fix it.
 *
 * ## Why it runs on its own, and why it stops running
 *
 * Opening an application that has a posting behind it starts the read, once —
 * and the answer is kept on the document, so the next visit, the next reload
 * and the next device show it without paying for it again. That is the whole
 * change: it used to re-read on every refresh, which is what a module-level
 * cache means the moment a tab is closed.
 *
 * Re-run is how a person disagrees with an answer they already have, after
 * re-capturing the posting or changing the model. Clear is how they say they do
 * not want one — and because it is remembered, the panel stops offering to
 * measure this posting until they ask. Both live in the ⋯ menu, destructive
 * last, which is what the Delete law requires of anything that removes a thing.
 */

const STEP_LABEL: Record<FitStep, string> = {
  reading: 'Opening the posting',
  asking: 'Reading what it asks for',
}

export function FitPanel({ applicationId }: { applicationId: string }) {
  const fit = useFit(applicationId)
  const { toast } = useToast()
  const { source, guidance } = fit

  return (
    <Panel aria-labelledby={`fit-${applicationId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`fit-${applicationId}`} className="flex items-center gap-2 font-medium">
          <Target aria-hidden className="size-4 text-muted-foreground" />
          How you fit
        </h2>
        <div className="flex items-baseline gap-3">
          {source && (
            <p className="text-xs text-muted-foreground">
              Measured against{' '}
              <Link className="underline underline-offset-2" to={vaultPath({ tool: 'files' })}>
                {source.name}
              </Link>{' '}
              — {HOW_LABEL[source.how]}
            </p>
          )}
          {/*
           * What Re-run is for: the posting was captured again, the model was
           * changed, or the person simply does not believe the verdict. All
           * three leave the document unchanged, so the stored reading holds the
           * very answer they are rejecting — which is why this bumps an attempt
           * rather than clearing anything, and why the read is forced past what
           * is kept. The last answer stays on screen while the new one is read:
           * a card that blanked itself would spend the read saying less than it
           * knew.
           *
           * The MENU is offered whenever there is anything in it, which is not
           * the same as `ready`. `ready` alone would take it away exactly when a
           * reading is stored and the model has since been disconnected, leaving
           * a verdict on screen with no way to be rid of it. Re-run is the item
           * that needs a model; Clear does not.
           */}
          {(fit.ready || fit.reading !== undefined) && fit.step === null && (
            <RowMenu name="this fit reading" className="-my-1">
              {fit.ready && (
                <MenuItem icon={RotateCw} onSelect={fit.rerun}>
                  {fit.cleared ? 'Measure this posting' : 'Re-run'}
                </MenuItem>
              )}
              {fit.reading && !fit.cleared && (
                <MenuItem
                  icon={Trash2}
                  danger
                  onSelect={() => {
                    const cleared = fit.clear()
                    if (!cleared) return
                    const { result, restore } = cleared
                    toast({
                      // The title branches, because a refusal that announces
                      // "Fit reading cleared" and then explains why it did not
                      // is a toast arguing with itself.
                      title: result.ok ? 'Fit reading cleared' : 'That did not clear',
                      description: result.ok
                        ? 'jojo will not read this posting again unless you ask it to.'
                        : (result.errors[0]?.message ?? ''),
                      ...(result.ok
                        ? restore
                          ? {
                              action: {
                                label: 'Undo',
                                onClick: () => {
                                  const outcome = restore()
                                  // `undoableWith` declines to put a before-image
                                  // back over a record touched since, and says so
                                  // rather than looking like it worked.
                                  if (outcome.superseded.length > 0) toast(supersededToast(outcome))
                                },
                              },
                            }
                          : {}
                        : { tone: 'danger' as const }),
                    })
                  }}
                >
                  Clear this reading
                </MenuItem>
              )}
            </RowMenu>
          )}
        </div>
      </div>

      {/* ------------------------- nothing to say ------------------------- */}
      {fit.blocked === 'no-posting' && (
        <p className="mt-3 text-sm text-muted-foreground">
          There is no saved posting behind this application, so there is nothing to weigh you
          against. Capture the listing with the extension, or add the application from its link, and
          this fills in.
        </p>
      )}

      {fit.blocked === 'no-model' && (
        <p className="mt-3 text-sm text-muted-foreground">
          Reading what a posting asks for needs a model.{' '}
          <Link className="underline underline-offset-2" to={settingsPath()}>
            Connect one in Settings
          </Link>
          .
        </p>
      )}

      {fit.blocked === 'no-background' && (
        <p className="mt-3 text-sm text-muted-foreground">
          jojo has not read anything about your background yet, so it cannot weigh this posting
          against it. Put your CV in the Vault and say yes when it offers to read it.
        </p>
      )}

      {/* An answer, not a gap. Nothing here offers to fill it in — the menu
          above turns back into "Measure this posting", which is the one way
          back and the only one the person asked for. */}
      {fit.blocked === null && fit.cleared && fit.step === null && (
        <p className="mt-3 text-sm text-muted-foreground">
          You cleared this reading, so jojo is leaving this posting alone.
        </p>
      )}

      {/* ---------------------------- working ----------------------------- */}
      {fit.step !== null && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          {STEP_LABEL[fit.step]}…
        </p>
      )}

      {fit.error !== null && (
        <div className="mt-3 text-sm">
          <p className="text-danger">{fit.error}</p>
          <Button className="mt-2" size="sm" variant="ghost" onClick={fit.rerun}>
            Try again
          </Button>
        </div>
      )}

      {/* ---------------------------- the answer -------------------------- */}
      {guidance && (
        <div className="mt-3 space-y-4 text-sm">
          <div>
            <p className="font-medium">{VERDICT_LABEL[guidance.verdict]}</p>
            <p className="mt-1 text-muted-foreground">{guidance.summary}</p>
          </div>

          {guidance.tailor.length > 0 && (
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Lead with
              </h3>
              <ul className="mt-1.5 space-y-1.5">
                {guidance.tailor.map((note) => (
                  <li key={note.evidence.id}>
                    <span className="font-medium">{note.evidence.title}</span>
                    {note.evidence.where !== undefined && (
                      <span className="text-muted-foreground"> · {note.evidence.where}</span>
                    )}
                    <span className="block text-muted-foreground">answers “{note.answers}”</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {guidance.prepare.length > 0 && (
            <div>
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Be ready for
              </h3>
              <ul className="mt-1.5 space-y-1.5">
                {guidance.prepare.map((note) => (
                  <li key={note.requirement}>
                    <span className="font-medium">
                      {note.requirement}
                      {note.essential && (
                        <span className="ml-1.5 rounded bg-warning-soft px-1.5 py-0.5 text-xs font-normal text-warning">
                          required
                        </span>
                      )}
                    </span>
                    <span className="block text-muted-foreground">{note.advice}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
           * Where the answer came from, under it rather than over it.
           *
           * This is the price of keeping a verdict past the session that
           * produced it: a reload used to throw away anything old, and now
           * nothing does, so the card has to be able to say how old it is and
           * what read it. `staleOf` adds a sentence only when the connected
           * model is not the one that read this — never when there is no model
           * connected, which is a different problem with its own line above.
           */}
          {fit.readNote && (
            <p className="text-xs text-muted-foreground">
              {fit.readNote}
              {fit.reading?.skipped !== undefined &&
                ` · ${String(fit.reading.skipped)} line${fit.reading.skipped === 1 ? '' : 's'} skipped`}
              {fit.stale && <span className="block text-warning">{STALE_NOTE[fit.stale]}</span>}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}
