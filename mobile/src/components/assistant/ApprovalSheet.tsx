import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { proposalDetail } from '@jojo/service/core/proposal'
import { useAgentRuns, useWaitingRuns } from '@jojo/service/react/agent-runs-context'
import { useThreads } from '@jojo/service/react/use-threads'
import { space } from '@/theme/tokens'

/**
 * Answers a destructive step from wherever the person happens to be.
 *
 * Mounted at the root beside `SheetHost`, for the reason the web's
 * `ApprovalHost` is mounted beside the dialog host — and the reason bites
 * harder here. Every exit from the Assistant screen POPS it: it is always the
 * leaf of the stack, so the back gesture, the header button and both in-screen
 * `navigate` calls all unmount it. An approval held in that screen's state
 * therefore had no way to be answered the moment anyone left, and `runAgent`
 * parked on `await approve(...)` forever with the exchange never saved.
 *
 * A sheet rather than the web's corner card, because that is what a modal
 * question looks like on this platform — and unlike the web version it does
 * seize the screen, which is the right call on a phone: there is no corner to
 * put something in that a person will notice.
 *
 * Only the first waiting run is drawn. Two at once is possible and rare, and a
 * stack of sheets is worse than answering them one at a time.
 */
export function ApprovalSheet() {
  const waiting = useWaitingRuns()
  const runs = useAgentRuns()
  const { threads } = useThreads()

  const run = waiting[0]
  const step = run?.pending?.step
  const named = threads.find((t) => t.id === run?.threadId)

  /*
   * `null` when the tool takes no arguments worth showing — `memory.overview`
   * has none, and an empty line above the id reads as a missing value rather
   * than as nothing to say.
   */
  const detail = step === undefined ? null : proposalDetail(JSON.stringify(step.args ?? {}))

  return (
    <Sheet
      open={run !== undefined && step !== undefined}
      onClose={() => {
        if (run) runs.decide(run.threadId, false)
      }}
      title={step?.title ?? ''}
      description={`Asked by ${named?.title ?? 'a conversation'}. Nothing has changed yet.`}
      footer={
        <>
          <Button
            label="Don’t"
            variant="ghost"
            size="md"
            onPress={() => {
              if (run) runs.decide(run.threadId, false)
            }}
          />
          <Button
            label="Allow"
            size="md"
            onPress={() => {
              if (run) runs.decide(run.threadId, true)
            }}
          />
        </>
      }
    >
      <View style={{ paddingBottom: space[2], gap: space[1.5] }}>
        {/*
          * WHAT it would run, before what it is called.
          *
          * This comment used to claim the sheet showed "a delete whose target
          * they cannot otherwise see from here" while rendering only the tool's
          * id — so "Delete application" was approved without knowing which one.
          * The web card has rendered `proposalDetail` for exactly this reason:
          * a person being asked to approve a note without being shown the note
          * is not being asked anything.
          */}
        {detail !== null && <Txt size="sm">{detail}</Txt>}
        <Txt size="xs" tone="muted" mono>
          {step?.name ?? ''}
        </Txt>
      </View>
    </Sheet>
  )
}
