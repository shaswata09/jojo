import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, ArrowRight, Compass, RotateCcw } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { Kbd } from '@/components/guide/Kbd'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { STAGES } from '@/data/seed'
import { useDialogs, type DialogName } from '@/lib/dialogs-context'
import { applicationsPath, settingsPath, vaultPath } from '@/lib/links'
import { readStored, removeStored, writeStored } from '@/lib/storage'
import { cn } from '@/lib/utils'

/**
 * The guided tour.
 *
 * THE SHAPE, AND THE THREE SHAPES IT IS NOT.
 *
 * It is not a scripted click-through of a fake interface. That version has to
 * invent screens the app cannot produce — a scored scout match, a completed
 * transfer — and the reader finds out inside two minutes, at which point every
 * other sentence in the guide is suspect too. Everything else in this codebase
 * was built to avoid exactly that: the snapshot button that is disabled with
 * its reason on hover, the assistant reply that says it is canned, the transfer
 * page that says nothing was transmitted. A tutorial does not get an exemption.
 *
 * It is not a coach-mark overlay walking across the app either, though that was
 * the first design. To survive a route change an overlay has to be mounted
 * above the router, and the only mount points above the router belong to the
 * app shell — which this package does not own. What is here is the same
 * contract in a shape that fits: point, explain, hand over to the real control,
 * and keep the reader's place so the handover is not a dead end.
 *
 * And it is not a second copy of the reference pages. Every step is about where
 * a thing IS and what it will do when you press it, which is the part a written
 * page is worst at — six of the thirteen routes are not in the sidebar at all.
 *
 * THE RULE THAT MAKES IT HONEST: it never types, never submits and never
 * writes. A tour that filled in a form and saved it would author a record the
 * reader did not author, and in this app that record is then visible in three
 * places — the list, the undo stack and the audit log — as something they did
 * not do. Every step ends with the real control in front of them, untouched.
 *
 * THE DELIBERATE OMISSION: no step on scout matches, the assistant or transfer.
 * Those three screens are honest about themselves in place, and walking a
 * first-time reader through them as though they were finished features is the
 * same lie the fake click-through tells, only slower. They are covered on the
 * reference page, where the reader arrives already knowing what to expect.
 */

/** Where the reader got to. Deliberately not a record — see below. */
const PROGRESS_KEY = 'jojo.tour.step'

/**
 * Progress lives in localStorage, next to the theme and the sound switch, and
 * deliberately NOT in the graph.
 *
 * The store is the user's job search. "How far through a tutorial you are" is
 * not a thing they own, would show up in the audit log as a write they did not
 * make, would land in the export, and would be undoable with ⌘Z — which is
 * absurd for a bookmark. It is a browser preference, so it is stored like one,
 * through the guarded helpers: `localStorage` is a getter that THROWS in
 * blocked-storage browsers, and the tour must open in exactly those.
 */
function readProgress(total: number): number {
  const raw = readStored(PROGRESS_KEY)
  if (raw === null) return 0
  const parsed = Number.parseInt(raw, 10)
  // A hand-edited or stale value must not strand the reader on a step that no
  // longer exists — steps get added and removed, the stored number does not.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= total) return 0
  return parsed
}

/**
 * Where a step hands over.
 *
 * A union rather than two optional fields, so a hand-off cannot be written with
 * both or neither — the version with `to?` and `dialog?` needed a non-null
 * assertion at the call site, which is the type system asking to be told which
 * of the two this is.
 */
type Handoff = { label: string; note: string } & (
  | { kind: 'route'; to: string }
  /**
   * The real dialog, opened by name the way the checklist on this page opens
   * it — never a copy of it, and never one with anything filled in.
   */
  | { kind: 'dialog'; name: DialogName; props?: Record<string, unknown> }
)

type TourStep = {
  /** A stable name for the step, and the React key of its body. */
  id: string
  title: string
  /** One line, read out with the title. */
  lede: string
  body: ReactNode
  handoff?: Handoff
}

/** The six stages, from the same list the board and the table draw from. */
function StageRow() {
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5">
      {STAGES.map((stage) => (
        <li key={stage.id}>
          <Chip stage={stage.id}>{stage.label}</Chip>
        </li>
      ))}
    </ul>
  )
}

const STEPS: TourStep[] = [
  {
    id: 'contract',
    title: 'What this tour does',
    lede: 'Seven steps, and it changes nothing.',
    body: (
      <>
        <p>
          It points at things and opens the real controls on the real pages. It never types anything
          for you, never saves a record and never changes a setting — every step ends with something
          in front of you that you press, or do not.
        </p>
        <p className="mt-2">
          Nothing here is a picture of a feature behaving differently from the way it behaves. Where
          something cannot be shown without pretending — what you see if the browser refuses to
          store anything, for instance — it is described and not drawn.
        </p>
        <p className="mt-2">
          Close it whenever you like. Your place is kept in this browser, and the button you opened
          it with will offer to pick it up again.
        </p>
      </>
    ),
  },
  {
    id: 'application',
    title: 'One record holds a job application',
    lede: 'Everything else in jojo hangs off it.',
    body: (
      <>
        <p>
          A position, an employer, a stage and whatever you have written down about it. Deadlines,
          interviews, follow-ups, documents and keywords all attach to that one record, which is why
          nothing has to be typed twice. Six stages, and a record sits in exactly one of them:
        </p>
        <StageRow />
        <p className="mt-3">
          The same records appear as a board or as a table — the segment at the top of the page
          switches between them and the choice is in the address, so a link you send opens the way
          you left it. Dragging a card to another column is a real edit: it announces itself and it
          undoes.
        </p>
      </>
    ),
    handoff: {
      kind: 'route',
      label: 'Open Applications',
      to: applicationsPath(),
      note: 'Leaves the guide for the board. Come back here and the tour resumes at the next step.',
    },
  },
  {
    id: 'new',
    title: 'Making one',
    lede: 'New in the top bar, or the n key.',
    body: (
      <>
        <p>
          The <strong className="font-medium text-text-1">New</strong> button in the top bar makes
          any of six things — an application, a reminder, a calendar entry, a drafted message, a
          saved link, a saved posting. Pressing <Kbd>n</Kbd> anywhere that is not a text box opens
          the same menu.
        </p>
        <p className="mt-2">
          One dialog is open at a time, by design: asking for a second replaces the first rather
          than stacking them. Nothing is written until you save, and closing a half-filled form
          costs nothing but the typing.
        </p>
      </>
    ),
    handoff: {
      kind: 'dialog',
      name: 'application',
      label: 'Open the real dialog',
      note: 'Closes the tour and opens the new-application form, empty. It is the same dialog the New button opens, not a copy of it.',
    },
  },
  {
    id: 'dates',
    title: 'A deadline, an interview and a follow-up are one kind of record',
    lede: 'Which is why one entry reaches three screens.',
    body: (
      <>
        <p>
          They differ by a field, not by a type. A reminder is that same record with a nudge
          switched on — so it appears in the calendar, on the dashboard and on the application it
          belongs to at once, and ticking it off in any of them ticks it off in all of them.
        </p>
        <p className="mt-2">
          Once a reminder&rsquo;s date has passed it stays flagged on the dashboard until you
          complete it. Dragging one onto another day in the{' '}
          <span className="text-text-1">calendar</span> reschedules it, with an undo.
        </p>
      </>
    ),
    handoff: {
      kind: 'dialog',
      name: 'timelineItem',
      // `mode` chooses which of the two forms opens; it is not a value in a
      // field. Nothing on this hand-off pre-fills anything, which is the
      // difference between opening a form and filling one in.
      props: { mode: 'event' },
      label: 'Open the real dialog',
      note: 'Closes the tour and opens the calendar-entry form, empty. Nothing is saved unless you save it.',
    },
  },
  {
    id: 'palette',
    title: 'The fastest way in is the keyboard',
    lede: '⌘K searches, and runs the app’s own operations.',
    body: (
      <>
        <p>
          <Kbd>⌘K</Kbd> — <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> on Windows and Linux — opens a search across
          your applications, reminders and calendar entries. Below those it lists the app&rsquo;s
          named operations, each with a form built from the operation itself rather than written out
          by hand, so what the palette offers cannot drift from what the app can do.
        </p>
        <p className="mt-2">
          It is also the way to the pages the sidebar does not list: the graph, transfer, your
          profile, the assistant, settings and this guide. The shortcut is ignored while you are
          typing in a field, so it never steals a keystroke from a note.
        </p>
        <p className="mt-2 text-text-3">
          No button for this one — there is nothing here that can open it. Close the tour and press
          the keys.
        </p>
      </>
    ),
  },
  {
    id: 'undo',
    title: 'Undo is real, and every write is written down',
    lede: 'Two undos, and they do different things.',
    body: (
      <>
        <p>
          <Kbd>⌘Z</Kbd> undoes the last thing you changed and <Kbd>⇧⌘Z</Kbd> puts it back, anywhere
          in the app, suppressed while you are typing. The message that appears after a change
          carries its own Undo, and the two are not the same: the message reverts <em>that</em>{' '}
          change, <Kbd>⌘Z</Kbd> reverts the most recent one. Seconds apart, those are two different
          records.
        </p>
        <p className="mt-2">
          Every write is listed in the audit log at the foot of Settings, newest first. The log
          survives a reload; the undo stack does not — it starts empty each visit, because an undo
          that reached back to last Tuesday is not an undo.
        </p>
      </>
    ),
    handoff: {
      kind: 'route',
      label: 'Open Settings',
      to: settingsPath(),
      note: 'The audit log and the diagnostics panel are at the foot of that page.',
    },
  },
  {
    id: 'storage',
    title: 'Where your records actually are',
    lede: 'A database inside this browser, on this machine.',
    body: (
      <>
        <p>
          Records are written to this browser as you work, so closing the tab is safe. Nothing is
          sent anywhere and nothing syncs — clearing your browser data, switching browsers or losing
          the disk takes them with it. Settings exports the lot as a <Kbd>.json</Kbd> file, which is
          a copy taken at that moment rather than a backup that keeps up.
        </p>
        <p className="mt-2">
          If the browser ever refuses to store anything, the app keeps running behind a banner
          saying which of three things went wrong. One of those arms has no reload button on
          purpose: reloading would throw away writes still waiting to be saved. There is no picture
          of it here, because you should only ever see it if it happens.
        </p>
        <p className="mt-2">
          That is the tour. The rest of the guide covers every screen in turn, the record model
          underneath, and what jojo is built from.
        </p>
      </>
    ),
    handoff: {
      kind: 'route',
      label: 'Open the Vault',
      to: vaultPath(),
      note: 'Reminders, links, files, snippets and a calculator — the five tools that are not the applications list.',
    },
  },
]

/**
 * The tour, and the button that opens it.
 *
 * One component rather than a launcher plus a separately mounted overlay: the
 * dialog belongs to the button that summoned it, and splitting them would mean
 * a page could mount one without the other. It must be rendered inside the
 * router — every hand-off is a real link — which any guide page is.
 */
export function TourLauncher({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(() => readProgress(STEPS.length))
  const { open: openDialog } = useDialogs()

  /**
   * What to do once this dialog has finished closing.
   *
   * The app mounts one dialog at a time and asking for a second replaces the
   * first, so a hand-off cannot simply call `open('timelineItem')` while the
   * tour is still up — the two would fight over the focus scope, and the loser
   * leaves focus on a node that has been removed. Radix fires
   * `onCloseAutoFocus` when the tour is on its way out, which is exactly the
   * moment the next dialog may take over.
   */
  const pending = useRef<(() => void) | null>(null)

  /**
   * The Next/Finish button — the footer's landing place for focus.
   *
   * It is the one control that is present and enabled at every step, which is
   * what makes it the right thing to hand focus to when another control is
   * about to disable itself. See the footer for the three cases.
   */
  const advanceRef = useRef<HTMLButtonElement>(null)

  /** The scroll container, which is the dialog itself — see its className. */
  const contentRef = useRef<HTMLDivElement>(null)

  const total = STEPS.length
  const current = STEPS[step] ?? STEPS[0]
  const isLast = step === total - 1

  const remember = useCallback((next: number) => {
    setStep(next)
    writeStored(PROGRESS_KEY, String(next))
  }, [])

  const go = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(step + delta, 0), total - 1)
      if (next !== step) remember(next)
    },
    [step, total, remember],
  )

  /**
   * Finishing clears the bookmark rather than parking on the last step.
   *
   * Otherwise the button reads "Resume — step 7 of 7" forever, and pressing it
   * reopens the ending. Clearing means the next press starts at the beginning,
   * which is what "take the tour again" has to mean.
   */
  const finish = useCallback(() => {
    removeStored(PROGRESS_KEY)
    setStep(0)
    setOpen(false)
  }, [])

  /**
   * A hand-off advances first, then leaves.
   *
   * The step being handed off is done — the reader is about to go and do it —
   * so resuming should land on the next one. Getting this backwards produces a
   * tour that offers the same page every time it is reopened.
   */
  const handOff = useCallback(
    (handoff: Handoff) => {
      if (!isLast) remember(step + 1)
      else removeStored(PROGRESS_KEY)
      if (handoff.kind === 'dialog') {
        pending.current = () => openDialog(handoff.name, handoff.props)
      }
      setOpen(false)
    },
    [isLast, remember, step, openDialog],
  )

  // Left and right walk the tour, the way they walk any stepped surface. No
  // guard for typing targets is needed — there is no field in here — but a
  // modifier means the browser's own shortcut and must be left alone.
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (event.key === 'ArrowRight' && !isLast) {
        event.preventDefault()
        go(1)
      }
      if (event.key === 'ArrowLeft' && step > 0) {
        event.preventDefault()
        go(-1)
      }
    },
    [go, isLast, step],
  )

  /**
   * Each step starts at its own beginning.
   *
   * The dialog is the scroll container, and scroll position belongs to the
   * element rather than to what is inside it — so a reader who scrolled to the
   * foot of a long step and pressed Next landed on the next one already partway
   * down, having apparently skipped its opening paragraph. Remounting the body
   * does not fix that; only moving the container does.
   */
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [step])

  const started = step > 0

  return (
    <>
      <Button
        variant="outline"
        className={cn('gap-1.5', className)}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Compass aria-hidden />
        {started ? `Resume the tour — step ${step + 1} of ${total}` : 'Take the tour'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          /* Capped and scrollable, the way ToolRunDialog is. A dialog is
             centred on the viewport with no height limit of its own, so the
             longest step here — six stage chips and three paragraphs — ran off
             both ends of a 390×700 phone, taking Next with it and leaving
             Escape as the only way out of a tutorial. */
          className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
          ref={contentRef}
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(event) => {
            const run = pending.current
            if (!run) return
            pending.current = null
            // Let the next dialog claim focus instead of handing it back to the
            // button that opened this one, which would put the reader outside
            // the thing they just asked for.
            event.preventDefault()
            run()
          }}
        >
          <DialogHeader>
            <DialogTitle>{current.title}</DialogTitle>
            <DialogDescription>{current.lede}</DialogDescription>
          </DialogHeader>

          {/* The title only announces on open, so the step change has to be
              announced separately — otherwise Next is silent to a screen
              reader and the reader has no idea anything happened. */}
          <p aria-live="polite" className="sr-only">
            {`Step ${step + 1} of ${total}: ${current.title}`}
          </p>

          <div key={current.id} className="text-sm text-text-2">
            {current.body}
          </div>

          {/* Bound to a local so the narrowing survives into the callbacks —
              `current.handoff` is a property read and TypeScript re-widens it
              inside a closure, which is what the non-null assertions here were
              papering over. */}
          {(() => {
            const handoff = current.handoff
            if (!handoff) return null
            return (
              <div className="rounded-lg border border-hairline bg-well p-3">
                {handoff.kind === 'route' ? (
                  <Button variant="secondary" size="sm" asChild>
                    <Link to={handoff.to} onClick={() => handOff(handoff)}>
                      {handoff.label}
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => handOff(handoff)}>
                    {handoff.label}
                  </Button>
                )}
                {/* What the button will do, before it is pressed. A tour that
                    navigates without warning reads as having lost the reader's
                    place rather than as having handed over. */}
                <p className="mt-2 text-xs text-text-3">{handoff.note}</p>
              </div>
            )
          })()}

          {/* THE FOOTER, AND THE ONE BUG IT KEEPS TRYING TO HAVE.
              A control that disables or unmounts ITSELF as a result of its own
              click drops focus on the floor: the browser blurs a disabled
              element, React discards a removed one, and either way
              `document.activeElement` becomes <body> — inside a focus-trapped
              dialog, where the next Tab starts from the top again. Three
              controls here can do it (Back at step 1, Start over, and Next when
              it becomes Finish), so all three are handled rather than
              rediscovered one at a time. */}
          <DialogFooter className="items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <p className="tabular text-xs text-text-3">
                Step {step + 1} of {total}
              </p>
              {/* Rendered at every step and disabled at the first, rather than
                  appearing and disappearing — a control that comes and goes
                  under the pointer is worse than one that greys out. */}
              <Button
                variant="ghost"
                size="xs"
                disabled={!started}
                onClick={() => {
                  advanceRef.current?.focus()
                  remember(0)
                }}
                className="gap-1 text-text-3"
              >
                <RotateCcw aria-hidden />
                Start over
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Focus moves BEFORE the state change, while this button is
                  // still enabled and the target still exists. Doing it after
                  // would need a layout effect to find a node React has not
                  // rendered yet.
                  if (step === 1) advanceRef.current?.focus()
                  go(-1)
                }}
                disabled={step === 0}
                className="gap-1"
              >
                <ArrowLeft aria-hidden />
                Back
              </Button>
              {/* One button, not two. Next and Finish as separate elements
                  swapped one DOM node for another on the last step, and the
                  keyboard user who pressed Next to get there was left with
                  nothing focused. Same node, different label and handler. */}
              <Button
                ref={advanceRef}
                size="sm"
                onClick={isLast ? finish : () => go(1)}
                className="gap-1"
              >
                {isLast ? 'Finish' : 'Next'}
                {isLast ? null : <ArrowRight aria-hidden />}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
