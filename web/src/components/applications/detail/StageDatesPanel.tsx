import { CalendarClock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Input } from '@/components/ui/input'
import { STAGE_DOT, displayName } from '@/data/seed'
import type { Application, Stage } from '@/data/seed'
import { setStageDate, stageDateOf, stagesToDate } from '@jojo/service/core/stage-dates'
import { useApplications } from '@jojo/service/react/use-applications'
import { useToast } from '@/lib/toast-context'
import { useUndoable } from '@/lib/undo'
import { cn } from '@/lib/utils'
import { announceRefusal } from '@/components/common/write-result'
import { useDomain } from '@/i18n/domain'
import { isWholeDate } from '@/lib/date-draft'

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
  const { t } = useTranslation('applications')
  const domain = useDomain()
  const { update } = useApplications()
  const { toast } = useToast()
  const undoable = useUndoable()

  const rows = stagesToDate(a)

  const commit = (stage: Stage, typed: string) => {
    const on = typed.trim() === '' ? undefined : typed
    const before = stageDateOf(a, stage)
    // Nothing to do when it matches what is already stored, which is also
    // what makes tabbing through the panel free of writes. Half-typed years
    // never get this far: `StageDateInput` holds them as a draft.
    if (on === before) return

    /*
     * Through the journal rather than a before-image captured here: the same
     * Undo the file note's save uses, and for the same reason — the value that
     * was replaced is gone from the screen as well as from the record, so this
     * is a write with nothing visible to reverse it.
     */
    const { value, restore } = undoable(() => update(a.id, setStageDate(a, stage, on)))
    if (announceRefusal(value, toast)) return
    toast({
      title: on
        ? t('stageDates.dated', { stage: domain.stage(stage), date: domain.shortDate(on) })
        : t('stageDates.undated', { stage: domain.stage(stage) }),
      description: on
        ? t('stageDates.datedBody', {
            name: displayName(a),
            stage: domain.stage(stage),
          })
        : t('stageDates.undatedBody', { name: displayName(a) }),
      ...(restore ? { action: { label: t('common.undo'), onClick: restore } } : {}),
    })
  }

  return (
    <Panel className="min-w-0">
      <PanelTitle
        hint={t('stageDates.hint', {
          dated: rows.filter((s) => stageDateOf(a, s) !== undefined).length,
          total: rows.length,
        })}
      >
        {t('stageDates.title')}
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
                {domain.stage(stage)}
                {/* Where it is now, said once. The stage is on the header chip
                    too, and a second badge here would be decoration; this is
                    the word that tells you which row is still being lived. */}
                {here ? (
                  <span className="ms-1.5 text-xs text-text-3 [unicode-bidi:isolate]">
                    {t('stageDates.now')}
                  </span>
                ) : null}
              </span>
              <StageDateInput
                stored={on}
                // Named with the stage, because six identical "Date" fields in
                // one panel is one field announced six times.
                label={t('stageDates.dateLabel', {
                  name: displayName(a),
                  stage: domain.stage(stage),
                })}
                onCommit={(typed) => commit(stage, typed)}
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
          {t('stageDates.explain')}
        </p>
      ) : null}
    </Panel>
  )
}

/**
 * One stage's date, held as a draft while it is being typed.
 *
 * A native date field reports a value as soon as every segment holds one, so
 * typing a year digit by digit hands over '0002-09-14' first. Writing that is
 * refused (year 2 is not a day), and a field bound straight to the stored date
 * is then reset to empty — wiping the month and day already typed, so keyboard
 * entry could never succeed. The draft keeps whatever is in the field; only a
 * whole date writes as you go (which is also what a pick from the calendar
 * gives), and Enter or leaving the field commits the rest — including an
 * emptied field, which means "I do not know when this happened". A value the
 * store refuses stays in the field to be corrected rather than vanishing.
 */
function StageDateInput({
  stored,
  label,
  onCommit,
}: {
  stored: string | undefined
  label: string
  onCommit: (typed: string) => void
}) {
  const [draft, setDraft] = useState(stored ?? '')
  // Re-seeded when the record changes underneath (an Undo, another tab), the
  // render-time way rather than an effect, so the field never shows a stale
  // date for a frame.
  const [seen, setSeen] = useState(stored)
  if (seen !== stored) {
    setSeen(stored)
    setDraft(stored ?? '')
  }

  const settle = (input: HTMLInputElement) => {
    const typed = input.value
    // A half-filled field also reads as '', and `badInput` is what tells it
    // apart from one somebody emptied on purpose.
    if (typed === '' ? !input.validity.badInput : isWholeDate(typed)) onCommit(typed)
  }

  return (
    <Input
      type="date"
      value={draft}
      aria-label={label}
      aria-invalid={draft !== '' && !isWholeDate(draft) ? true : undefined}
      className="h-7 w-[9.5rem] shrink-0 px-2 text-sm"
      onChange={(event) => {
        const typed = event.target.value
        setDraft(typed)
        if (isWholeDate(typed)) onCommit(typed)
      }}
      onBlur={(event) => settle(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') settle(event.currentTarget)
      }}
    />
  )
}
