import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { STEPS } from '@/components/tour/steps'
import { isDone, mark, needsRoute, padded, placeCard, type Box } from '@/components/tour/tour-logic'
import { useMascot } from '@/lib/mascot-context'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

/** Around the lit element, so its edge is not flush with the cut-out. */
const PAD = 6
/** How long a ticked task shows its tick before the tour moves on, ms. */
const ADVANCE_MS = 900

/** The element a step lights, if it is on the page and on screen. */
function find(name: string | undefined): HTMLElement | null {
  if (!name) return null
  const el = document.querySelector<HTMLElement>(mark(name))
  if (!el) return null
  const r = el.getBoundingClientRect()
  // A closed drawer keeps the sidebar mounted, off the left edge: not on screen.
  if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.left >= window.innerWidth) return null
  return el
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5)

/**
 * The tour on screen: the page dimmed, a lit cut-out around the element the
 * step is about, and a card beside it saying what it is — and, for a
 * hands-on step, what to try. The tour moves on by itself once the reader has
 * done it; Next always works too, so no task can strand anyone.
 *
 * Only the lit element takes clicks while a step points at something, so
 * "Open Applications" cannot be answered by wandering off somewhere else; a
 * step whose menu or palette is open leaves the page usable.
 */
export function TourOverlay({
  index,
  dir,
  onGo,
  onLeave,
  onFinish,
}: {
  index: number
  /** Which way the reader is moving: a passed-over step is passed this way. */
  dir: 1 | -1
  onGo: (step: number) => void
  onLeave: () => void
  onFinish: () => void
}) {
  const step = STEPS[index] ?? STEPS[0]!
  const last = index === STEPS.length - 1
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { seq, play } = useMascot()
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const titleId = useId()
  const card = useRef<HTMLDivElement>(null)

  const [rect, setRect] = useState<Box | null>(null)
  const [size, setSize] = useState({ width: 320, height: 220 })
  /** The step whose task was seen done — a step id, so a new step starts undone. */
  const [doneFor, setDoneFor] = useState<string | null>(null)
  const done = doneFor === step.id
  /**
   * The step whose task was DONE WHILE IT WAS SHOWING — seen undone, then
   * done. Only that moves the tour on by itself. A task already true when its
   * step opens (Back onto "Open Applications" while on Applications) shows as
   * done and waits for Next: moving on would bounce the reader straight back
   * to where they came from.
   */
  const [advanceFor, setAdvanceFor] = useState<string | null>(null)
  /** A menu or popover is open (Radix's), which must be usable above the dim. */
  const [popper, setPopper] = useState(false)
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight })

  // What the per-frame check reads, kept current without restarting the loop.
  const world = useRef({ pathname, search, seq, base: seq })
  world.current.pathname = pathname
  world.current.search = search
  world.current.seq = seq

  const next = () => (last ? onFinish() : onGo(index + 1))

  // A new step: the page it is on opened, the robot's reaction, and the
  // mascot's count reset. Keyed on the step alone — re-running on a route
  // change would drag a reader back who had already moved on.
  useEffect(() => {
    if (step.only && !document.querySelector(mark(step.only))) {
      const on = index + dir
      if (on >= STEPS.length) onFinish()
      else onGo(Math.max(0, on))
      return
    }
    const to = needsRoute(step, world.current.pathname, world.current.search)
    if (to) void navigate(to)
    if (step.gesture) play(step.gesture)
    // After the step's own gesture, so it does not count as the reader's.
    world.current.base = world.current.seq + (step.gesture ? 1 : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per step, see above
  }, [step])

  // Measure, every frame, while the tour is up: the target can move — a page
  // loading in, the sidebar sliding, the board scrolling — and the tour is
  // short-lived, so a light per-frame read is the simplest thing that never
  // drifts. The task is checked on the same beat.
  useEffect(() => {
    let raf = 0
    let scrolled = false
    let ticked = false
    let seenUndone = false
    // A fresh visit to the step: an advance earned on an earlier visit (the
    // task done, then Back to it) must not fire again.
    setAdvanceFor(null)
    const tick = () => {
      const el = find(step.target)
      if (el && !scrolled) {
        scrolled = true
        const r = el.getBoundingClientRect()
        if (r.top < 0 || r.bottom > window.innerHeight) {
          el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
        }
      }
      const r = el?.getBoundingClientRect()
      const box = r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
      setRect((prev) => (sameBox(prev, box) ? prev : box))
      if (step.task && !ticked) {
        const w = world.current
        const now = isDone(step.task.done, {
          pathname: w.pathname,
          search: w.search,
          plays: w.seq - w.base,
          has: (selector) => document.querySelector(selector) !== null,
        })
        if (!now) seenUndone = true
        else {
          ticked = true
          setDoneFor(step.id)
          if (seenUndone) setAdvanceFor(step.id)
        }
      }
      const open = document.querySelector('[data-radix-popper-content-wrapper]') !== null
      setPopper((prev) => (prev === open ? prev : open))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [step, reduced])

  // Done while showing: a moment to see the tick, then on.
  const advance = advanceFor === step.id
  useEffect(() => {
    if (!advance) return
    const t = setTimeout(() => (last ? onFinish() : onGo(index + 1)), ADVANCE_MS)
    return () => clearTimeout(t)
  }, [advance, index, last, onGo, onFinish])

  useEffect(() => {
    const onResize = () => setView({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const observer = new ResizeObserver(() =>
      setSize({ width: el.offsetWidth, height: el.offsetHeight }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A step that points at something takes the focus, so Enter and the arrow
  // keys work at once. Not while a menu or the palette is open: that has the
  // focus, and the reader is using it.
  useEffect(() => {
    if (!step.open) card.current?.focus({ preventScroll: true })
  }, [step])

  // The keys: Escape leaves (the place is kept), the arrows walk. Left alone
  // while a menu is open, whose Escape closes the menu — the task.
  useEffect(() => {
    if (step.open) return
    const onKey = (event: KeyboardEvent) => {
      // A key something else already handled is not the tour's: Escape that
      // closed a popover or the phone drawer, an arrow that moved a radio
      // group. Radix and the Segment both mark theirs `defaultPrevented`.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      // The arrows walk the tour only from the tour card or the bare page —
      // never from a control the reader is using.
      const onTour = !target || target === document.body || card.current?.contains(target) === true
      if (event.key === 'Escape') onLeave()
      else if (event.key === 'ArrowRight' && onTour) next()
      else if (event.key === 'ArrowLeft' && onTour && index > 0) onGo(index - 1)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const lit = rect ? padded(rect, PAD) : null
  // Clicks reach only the lit element — unless the step's menu is open, or
  // there is nothing lit and the step asks the reader to go and do something
  // (the sidebar is a closed drawer on a phone, and its button must work).
  const shield = !step.open && !popper && (lit !== null || !step.task)
  const place = placeCard(lit, size, view, step.side)
  const move = reduced ? '' : 'transition-[left,top,width,height] duration-300 ease-out'

  return createPortal(
    <div className="tour-overlay fixed inset-0 z-[60]" style={{ pointerEvents: 'none' }}>
      {/* The dim, with the lit element cut out of it: one box whose shadow is
          the whole window. Never takes a click itself. */}
      {lit ? (
        <div
          aria-hidden
          className={cn('tour-spot absolute rounded-xl', move)}
          style={{ left: lit.left, top: lit.top, width: lit.width, height: lit.height }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}

      {/* The shield: four panes around the cut-out (or one over everything). */}
      {shield
        ? (lit
            ? [
                { left: 0, top: 0, width: view.width, height: Math.max(0, lit.top) },
                {
                  left: 0,
                  top: lit.top + lit.height,
                  width: view.width,
                  height: Math.max(0, view.height - lit.top - lit.height),
                },
                { left: 0, top: lit.top, width: Math.max(0, lit.left), height: lit.height },
                {
                  left: lit.left + lit.width,
                  top: lit.top,
                  width: Math.max(0, view.width - lit.left - lit.width),
                  height: lit.height,
                },
              ]
            : [{ left: 0, top: 0, width: view.width, height: view.height }]
          ).map((b, i) => (
            <div key={i} aria-hidden className="absolute" style={{ ...b, pointerEvents: 'auto' }} />
          ))
        : null}

      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'absolute w-[min(22rem,calc(100vw-1.5rem))] rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none',
          move,
        )}
        style={{ left: place.left, top: place.top, pointerEvents: 'auto' }}
      >
        <div key={step.id} className={reduced ? undefined : 'tour-card-in'}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-text-3">
              Step {index + 1} of {STEPS.length}
            </span>
            <button
              type="button"
              onClick={onLeave}
              aria-label="End the tour (your place is kept)"
              title="End the tour"
              className="-m-1 grid size-7 place-items-center rounded-md text-text-3 hover:bg-foreground/5 hover:text-text-1"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
            <div
              className={cn(
                'tour-progress h-full rounded-full',
                reduced ? '' : 'transition-[width] duration-300',
              )}
              style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          <h2 id={titleId} className="mt-3 text-base font-semibold text-text-1">
            {step.title}
          </h2>
          <p className="mt-1.5 leading-relaxed text-text-2">{step.body}</p>

          {step.task ? (
            <div
              className={cn(
                'mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2',
                done ? 'tour-task-done' : 'tour-task',
              )}
            >
              {done ? (
                <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />
              ) : (
                <span aria-hidden className="tour-dot size-2 shrink-0 rounded-full" />
              )}
              <span className="font-medium">
                {done ? 'Nice — that’s it.' : `Try it: ${step.task.say}`}
              </span>
            </div>
          ) : null}

          {/* Step changes are announced: the title only reads out on open. */}
          <p aria-live="polite" className="sr-only">
            {done
              ? 'Done.'
              : `Step ${index + 1} of ${STEPS.length}: ${step.title}. ${step.task ? `Try it: ${step.task.say}` : ''}`}
          </p>

          <div className="mt-4 flex items-center gap-2">
            {index > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => onGo(index - 1)}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onLeave}>
                Not now
              </Button>
            )}
            <Button size="sm" className="ml-auto" onClick={next}>
              {last ? 'Finish' : step.task && !done ? 'Skip this' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
