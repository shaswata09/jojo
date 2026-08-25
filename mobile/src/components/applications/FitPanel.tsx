import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { assess } from '@jojo/service/core/assess'
import type { Requirement } from '@jojo/service/core/assess'
import { HOW_LABEL, postingSourceFor } from '@jojo/service/core/posting-source'
import { guidanceFrom, VERDICT_LABEL } from '@jojo/service/core/tailor'
import { nextFitAction } from '@jojo/service/core/fit-request'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { cachedRequirements, haveRequirements, useReadFit } from '@/lib/fit-agent'
import type { FitStep } from '@/lib/fit-agent'
import { useModelSettings } from '@/lib/model-settings-context'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * How this application's posting weighs against what the person has done.
 *
 * The phone's half of web's `detail/FitPanel.tsx`, and the same three sections
 * in the same order: a verdict with its reason, what to lead with, what to be
 * ready for. `core/tailor.ts` computes all three and argues that none of them
 * may be a model's prose — every line names a record or a requirement.
 *
 * The four ways this has nothing to say are also the web file's, and each is
 * said differently there for the reason it gives: they are genuinely different
 * situations with different fixes, and one card reading "not enough
 * information" for all of them is a card people stop reading.
 */

const STEP_LABEL: Record<FitStep, string> = {
  reading: 'Opening the posting',
  asking: 'Reading what it asks for',
}

export function FitPanel({ applicationId }: { applicationId: string }) {
  const c = useColors()
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
    <Panel>
      <PanelTitle hint={source ? `${source.name} — ${HOW_LABEL[source.how]}` : undefined}>
        How you fit
      </PanelTitle>

      {!source && (
        <Txt size="sm" tone="secondary">
          There is no saved posting behind this application, so there is nothing to weigh you
          against. Capture the listing, or add the application from its link, and this fills in.
        </Txt>
      )}

      {source && !configured && (
        <Txt size="sm" tone="secondary">
          Reading what a posting asks for needs a model. Connect one under More → Settings.
        </Txt>
      )}

      {source && configured && background.length === 0 && (
        <Txt size="sm" tone="secondary">
          jojo has not read anything about your background yet, so it cannot weigh this posting
          against it. Put your CV in the Vault and say yes when it offers to read it.
        </Txt>
      )}

      {step !== null && (
        <Txt size="sm" tone="secondary">
          {STEP_LABEL[step]}…
        </Txt>
      )}

      {error !== null && (
        <View style={{ gap: space[2] }}>
          <Txt size="sm" color={c.danger}>
            {error}
          </Txt>
          <Button
            size="sm"
            variant="ghost"
            label="Try again"
            onPress={() => {
              setError(null)
              setAttempt((n) => n + 1)
            }}
          />
        </View>
      )}

      {guidance && (
        <View style={{ gap: space[4] }}>
          <View style={{ gap: space[1] }}>
            <Txt size="sm" weight="medium">
              {VERDICT_LABEL[guidance.verdict]}
            </Txt>
            <Txt size="sm" tone="secondary">
              {guidance.summary}
            </Txt>
          </View>

          {guidance.tailor.length > 0 && (
            <View style={{ gap: space[1.5] }}>
              <Txt size="xs" tone="muted" uppercase>
                Lead with
              </Txt>
              {guidance.tailor.map((note) => (
                <View key={note.evidence.id}>
                  <Txt size="sm" weight="medium">
                    {note.evidence.title}
                    {note.evidence.where === undefined ? '' : ` · ${note.evidence.where}`}
                  </Txt>
                  <Txt size="xs" tone="secondary">
                    answers “{note.answers}”
                  </Txt>
                </View>
              ))}
            </View>
          )}

          {guidance.prepare.length > 0 && (
            <View style={{ gap: space[1.5] }}>
              <Txt size="xs" tone="muted" uppercase>
                Be ready for
              </Txt>
              {guidance.prepare.map((note) => (
                <View key={note.requirement}>
                  <Txt size="sm" weight="medium">
                    {note.requirement}
                    {note.essential ? ' — required' : ''}
                  </Txt>
                  <Txt size="xs" tone="secondary">
                    {note.advice}
                  </Txt>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </Panel>
  )
}
