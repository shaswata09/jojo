import { CalendarClock } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Input } from '@/components/ui/input'
import { STAGE_DOT, STAGE_LABEL, displayName } from '@/data/seed'
import type { Application, Stage } from '@/data/seed'
import { shortDate } from '@/data/timeline'
import { setStageDate, stageDateOf, stagesToDate } from '@jojo/service/core/stage-dates'
import { useApplications } from '@jojo/service/react/use-applications'
import { useToast } from '@/lib/toast-context'
import { useUndoable } from '@/lib/undo'
import { cn } from '@/lib/utils'

/**
 * When this application reached each stage.
 *
 * The board already knew where an application had got to and never when it got
 * there: drag a card into Submitted and the column was the only record of it,
 * so "when did I send this" was a question the app could not answer about the
 * gesture it is built around. The stages are dated as they are entered now —
 * by whichever path moved it, since the stamp is in the tool every path goes
 * through — and this is where those dates are read and corrected.
 *
 * ## Why every row is an input
 *
 * A stamped date is a guess about the day somebody did something, and it is
 * wrong whenever the record catches up with reality later: you submit on
 * Friday, you tidy the board on Monday, and the stamp says Monday. It is a
 * better default than nothing and a worse answer than the one the person
 * actually remembers, so the correction has to be one click from the reading.
 * Read-only, this panel would be a list of dates telling somebody something
 * they know to be untrue.
 *
 * Emptying a field is allowed and means "I do not know when this happened",
 * which is not the same as never having reached the stage. The row stays put
 * for every stage at or before the one the record is in, because those are
 * lived through whether or not anybody dated them.
 *
 * It does NOT stay for a stage the record has since moved back past — clear the
 * Screening call date on something that is at Submitted again and the row goes.
 * That reads as a disappearing act until you see why: the date was the only
 * evidence that stage was ever reached, and deleting it deletes the evidence.
 * Undo brings both back, which is the honest offer to make about a write whose
 * effect is larger than the field it was made in.
 *
 * ## Which rows appear
 *
 * `stagesToDate` decides, and its rule is every stage lived through plus any
 * that carries a date. So a record that predates this feature offers the
 * stages it has already passed for filling in by hand, a record closed
 * straight from Draft shows the Closed row it earned, and no record offers to
 * date something that has not happened.
 */
export function StageDatesPanel({ application: a }: { application: Application }) {
  const { update } = useApplications()
  const { toast } = useToast()
  const undoable = useUndoable()

  const rows = stagesToDate(a)

  const commit = (stage: Stage, typed: string) => {
    const on = typed.trim() === '' ? undefined : typed
    const before = stageDateOf(a, stage)
    // A date picker fires on every keystroke in the year box, so a half-typed
    // '0026-09-14' arrives here as a value. Nothing to do when it matches what
    // is already stored, which is also what makes tabbing through the panel
    // free of writes.
    if (on === before) return

    /*
     * Through the journal rather than a before-image captured here: the same
     * Undo the file note's save uses, and for the same reason — the value that
     * was replaced is gone from the screen as well as from the record, so this
     * is a write with nothing visible to reverse it.
     */
    const { restore } = undoable(() => update(a.id, setStageDate(a, stage, on)))
    toast({
      title: on
        ? `${STAGE_LABEL[stage]} dated ${shortDate(on)}`
        : `${STAGE_LABEL[stage]} has no date now`,
      description: on
        ? `${displayName(a)} — this is the day the record says it reached ${STAGE_LABEL[stage].toLowerCase()}.`
        : `${displayName(a)} — the stage is still on the record; only its date is gone.`,
      ...(restore ? { action: { label: 'Undo', onClick: restore } } : {}),
    })
  }

  return (
    <Panel className="min-w-0">
      <PanelTitle
        hint={`${String(rows.filter((s) => stageDateOf(a, s) !== undefined).length)} of ${String(rows.length)} dated`}
      >
        Stage dates
      </PanelTitle>

      <ul className="space-y-1.5">
        {rows.map((stage) => {
          const on = stageDateOf(a, stage)
          const here = stage === a.stage
          return (
            <li key={stage} className="flex items-center gap-3">
              <span
                className={cn('size-1.5 shrink-0 rounded-full', STAGE_DOT[stage])}
                aria-hidden
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm',
                  here ? 'font-medium' : 'text-text-2',
                )}
              >
                {STAGE_LABEL[stage]}
                {/* Where it is now, said once. The stage is on the header chip
                    too, and a second badge here would be decoration; this is
                    the word that tells you which row is still being lived. */}
                {here ? <span className="ml-1.5 text-xs text-text-3">now</span> : null}
              </span>
              <Input
                type="date"
                value={on ?? ''}
                // Named with the stage, because six identical "Date" fields in
                // one panel is one field announced six times.
                aria-label={`Date ${displayName(a)} reached ${STAGE_LABEL[stage]}`}
                className="h-7 w-[9.5rem] shrink-0 px-2 text-sm"
                onChange={(event) => commit(stage, event.target.value)}
              />
            </li>
          )
        })}
      </ul>

      {/* One line, and only where it is still news: on a record whose dates
          were all stamped, saying how they got there is noise. */}
      {rows.every((s) => stageDateOf(a, s) === undefined) ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-text-3">
          <CalendarClock className="mt-px size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
          Moving this application to another stage dates it automatically. Anything it reached
          before today can be filled in here.
        </p>
      ) : null}
    </Panel>
  )
}
