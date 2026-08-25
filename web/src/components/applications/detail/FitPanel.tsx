import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Loader2, Target } from 'lucide-react'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { assess } from '@jojo/service/core/assess'
import type { Requirement } from '@jojo/service/core/assess'
import { HOW_LABEL, postingSourceFor } from '@jojo/service/core/posting-source'
import { guidanceFrom, VERDICT_LABEL } from '@jojo/service/core/tailor'
import { nextFitAction } from '@jojo/service/core/fit-request'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { cachedRequirements, haveRequirements, useReadFit } from '@/lib/fit-agent'
import type { FitStep } from '@/lib/fit-agent'
import { useModelSettings } from '@/lib/model-settings-context'
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
 * ## Why it runs on its own
 *
 * The ask was that assessing happen when an application is created rather than
 * on a button. It does: opening an application that has a posting behind it
 * starts the read, once, and `fit-agent.ts` caches the result on the DOCUMENT
 * so returning to the record is free and adding a publication moves the score
 * without paying again.
 *
 * The read is skipped while the graph holds no background, because there is
 * nothing to weigh the requirements against — spending somebody's GPU to
 * produce "not measured" is the one case where the button is right.
 */

const STEP_LABEL: Record<FitStep, string> = {
  reading: 'Opening the posting',
  asking: 'Reading what it asks for',
}

export function FitPanel({ applicationId }: { applicationId: string }) {
  const graph = useGraph()
  const { projections } = useKg()
  const { settings } = useModelSettings()
  const readFit = useReadFit()

  const source = useMemo(() => postingSourceFor(graph, applicationId), [graph, applicationId])
  const background = projections.background(graph)

  const [requirements, setRequirements] = useState<readonly Requirement[] | null>(
    () => cachedRequirements(source?.fileId ?? '') ?? null,
  )
  const [step, setStep] = useState<FitStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by Try again. See `fitRequestKey` — it is half the request's identity. */
  const [attempt, setAttempt] = useState(0)
  const abort = useRef<AbortController | null>(null)
  /**
   * The request already made, as a ref rather than state.
   *
   * Deliberately: recording that a request began must not cause a render, or
   * the decision changes as a consequence of having been taken. That is exactly
   * the loop this panel had — the read reported its first step synchronously,
   * the step was in the effect's dependency array, and the re-run's cleanup
   * aborted the request it had just started.
   */
  const started = useRef<string | null>(null)

  const fileId = source?.fileId
  const name = source?.name
  const configured = settings.model.trim() !== ''
  const ready = fileId !== undefined && configured && background.length > 0

  /*
   * `readFit` and `settings` are read through refs so that neither appears in
   * the dependency array below. `readFit`'s identity changes when the blob
   * store finishes opening, and a dependency that moves while a request is in
   * flight makes the cleanup abort it. What the effect must react to is the
   * DECISION changing, and that is what `action` is.
   */
  const latest = useRef({ readFit, settings })
  latest.current = { readFit, settings }

  const action = nextFitAction({
    ready,
    fileId,
    attempt,
    cached: fileId !== undefined && haveRequirements(fileId),
    started: started.current,
  })

  /*
   * Hoisted out of the dependency array, because a ternary in there cannot be
   * checked statically and this is the value the effect actually turns on.
   * `null` covers both non-start actions, and neither needs to be distinguished
   * from the other by an identity — `action.do` carries that.
   */
  const startKey = action.do === 'start' ? action.key : null

  useEffect(() => {
    if (action.do === 'nothing') return
    if (fileId === undefined || name === undefined) return

    if (action.do === 'use-cache') {
      setRequirements(cachedRequirements(fileId) ?? null)
      return
    }
    if (startKey === null) return

    started.current = startKey
    const stop = new AbortController()
    abort.current = stop
    const { readFit: read, settings: model } = latest.current

    void read({ fileId, name, settings: model, onStep: setStep, signal: stop.signal })
      .then((outcome) => {
        if (stop.signal.aborted) return
        abort.current = null
        setStep(null)
        if (outcome.ok) setRequirements(outcome.requirements)
        else setError(outcome.reason)
      })
      /*
       * Every layer under this reports failure as a value, so reaching here
       * means something threw that none of them expected. Without the catch
       * that is an unhandled rejection and a panel that spins on "Opening the
       * posting" for the rest of the session — the failure mode a person cannot
       * tell from a slow model.
       */
      .catch((thrown: unknown) => {
        if (stop.signal.aborted) return
        abort.current = null
        setStep(null)
        setError(thrown instanceof Error ? thrown.message : 'Reading the posting failed.')
      })
    return () => {
      stop.abort()
      abort.current = null
    }
    // `action.do` and `startKey`, not `action` — the object is rebuilt on every
    // render and would re-run this on every one of them.
  }, [action.do, startKey, fileId, name])

  /*
   * A different application means a different posting, so anything held about
   * the last one is wrong rather than stale — and the attempt counter goes back
   * to zero with it, or a retry on one record would look like a fresh request
   * on the next.
   */
  useEffect(() => {
    setRequirements(fileId === undefined ? null : (cachedRequirements(fileId) ?? null))
    setError(null)
    setStep(null)
    setAttempt(0)
  }, [fileId])

  const guidance = useMemo(
    () => (requirements === null ? null : guidanceFrom(assess(requirements, background))),
    [requirements, background],
  )

  return (
    <Panel aria-labelledby={`fit-${applicationId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`fit-${applicationId}`} className="flex items-center gap-2 font-medium">
          <Target aria-hidden className="size-4 text-muted-foreground" />
          How you fit
        </h2>
        {source && (
          <p className="text-xs text-muted-foreground">
            Measured against{' '}
            <Link className="underline underline-offset-2" to={vaultPath({ tool: 'files' })}>
              {source.name}
            </Link>{' '}
            — {HOW_LABEL[source.how]}
          </p>
        )}
      </div>

      {/* ------------------------- nothing to say ------------------------- */}
      {!source && (
        <p className="mt-3 text-sm text-muted-foreground">
          There is no saved posting behind this application, so there is nothing to weigh you
          against. Capture the listing with the extension, or add the application from its link,
          and this fills in.
        </p>
      )}

      {source && !configured && (
        <p className="mt-3 text-sm text-muted-foreground">
          Reading what a posting asks for needs a model.{' '}
          <Link className="underline underline-offset-2" to={settingsPath()}>
            Connect one in Settings
          </Link>
          .
        </p>
      )}

      {source && configured && background.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          jojo has not read anything about your background yet, so it cannot weigh this posting
          against it. Put your CV in the Vault and say yes when it offers to read it.
        </p>
      )}

      {/* ---------------------------- working ----------------------------- */}
      {step !== null && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          {STEP_LABEL[step]}…
        </p>
      )}

      {error !== null && (
        <div className="mt-3 text-sm">
          <p className="text-danger">{error}</p>
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            onClick={() => {
              setError(null)
              setAttempt((n) => n + 1)
            }}
          >
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
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lead with
              </h3>
              <ul className="mt-1.5 space-y-1.5">
                {guidance.tailor.map((note) => (
                  <li key={note.evidence.id}>
                    <span className="font-medium">{note.evidence.title}</span>
                    {note.evidence.where !== undefined && (
                      <span className="text-muted-foreground"> · {note.evidence.where}</span>
                    )}
                    <span className="block text-muted-foreground">
                      answers “{note.answers}”
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {guidance.prepare.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
        </div>
      )}
    </Panel>
  )
}
