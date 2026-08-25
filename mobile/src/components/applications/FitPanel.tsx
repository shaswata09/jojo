import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { assess } from '@jojo/service/core/assess'
import type { Requirement } from '@jojo/service/core/assess'
import { HOW_LABEL, postingSourceFor } from '@jojo/service/core/posting-source'
import { guidanceFrom, VERDICT_LABEL } from '@jojo/service/core/tailor'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { cachedRequirements, useReadFit } from '@/lib/fit-agent'
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
  const abort = useRef<AbortController | null>(null)

  const fileId = source?.fileId
  const name = source?.name
  const configured = settings.model.trim() !== ''
  const ready = fileId !== undefined && configured && background.length > 0

  /*
   * Runs once per document per session, guarded on `error` as well as on the
   * result: a posting that failed to read fails the same way on every render,
   * and retrying it unasked would be a loop against somebody's GPU — which on a
   * phone is somebody's battery too.
   */
  useEffect(() => {
    if (!ready || fileId === undefined || name === undefined) return
    if (requirements !== null || error !== null || step !== null) return

    const held = cachedRequirements(fileId)
    if (held) {
      setRequirements(held)
      return
    }

    const stop = new AbortController()
    abort.current = stop
    void readFit({ fileId, name, settings, onStep: setStep, signal: stop.signal }).then(
      (outcome) => {
        abort.current = null
        setStep(null)
        if (outcome.ok) setRequirements(outcome.requirements)
        else setError(outcome.reason)
      },
    )
    return () => {
      stop.abort()
      abort.current = null
    }
  }, [ready, fileId, name, requirements, error, step, readFit, settings])

  // A different application means a different posting, so anything held about
  // the last one is wrong rather than stale.
  useEffect(() => {
    setRequirements(cachedRequirements(fileId ?? '') ?? null)
    setError(null)
    setStep(null)
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
