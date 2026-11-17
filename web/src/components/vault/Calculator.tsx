import { useCallback, useEffect, useRef, useState } from 'react'
import { Delete, History, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { cn } from '@/lib/utils'
import { UNARY, apply, format, toggleSign } from '@jojo/service/core/calculator'
import type { Op } from '@jojo/service/core/calculator'
// `MAX_DIGITS` is imported rather than redeclared: the keypad caps typed input
// at the same width the shared `format` caps output at, and the two drifting
// apart would let someone type a number the display could not print back.
import { MAX_DIGITS } from '@jojo/service/core/calculator'
import { planCalculatorKey } from './calculator-keys'
import { type HistoryEntry, withEntry } from './calculator-history'

type Mode = 'basic' | 'scientific'

/** Each operator's spoken name, as a catalog key under `calculator.ops`. */
const OP_KEY: Record<Op, string> = {
  '+': 'plus',
  '−': 'minus',
  '×': 'times',
  '÷': 'dividedBy',
  '^': 'power',
}

/**
 * A four-function calculator with an optional scientific pad and a running
 * history.
 *
 * THE KEYPAD ONLY. The arithmetic is `@jojo/service/core/calculator`, shared
 * with the phone and tested there. It used to be inlined here — `format`,
 * `apply` and a `UNARY` table, sixty-odd lines with no test file beside them,
 * while `mobile` had the same three extracted and covered. `check-no-copies`
 * could not see it because the two were never byte-identical, and they had
 * already drifted: this pad was missing `log` and `±`, and called x² by a
 * different key than the phone did — and both had a `±` that did a different
 * thing, which briefly showed up as two of them side by side in this pad.
 *
 * The history is still session-only. That is now the one thing in this file
 * that is unfinished rather than a consequence of persistence not existing —
 * it does exist.
 */
export function Calculator() {
  const { t } = useTranslation('vault')
  // Built in the render so the labels follow the language on screen.
  const modes = [
    { value: 'basic', label: t('calculator.modes.basic') },
    { value: 'scientific', label: t('calculator.modes.scientific') },
  ] as const
  const [display, setDisplay] = useState('0')
  /** The left-hand side of a pending operation, held while the right is typed. */
  const [accumulator, setAccumulator] = useState<number | null>(null)
  const [pending, setPending] = useState<Op | null>(null)
  /** True once a result or operator has landed, so the next digit starts fresh. */
  const [replace, setReplace] = useState(true)

  const [mode, setMode] = useState<Mode>('basic')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const record = useCallback((expr: string, value: string) => {
    setHistory((prev) => withEntry(prev, expr, value))
  }, [])

  const digit = useCallback(
    (d: string) => {
      setDisplay((prev) => {
        if (replace) return d === '.' ? '0.' : d
        if (d === '.' && prev.includes('.')) return prev
        if (prev.replace('-', '').replace('.', '').length >= MAX_DIGITS) return prev
        return prev === '0' && d !== '.' ? d : prev + d
      })
      setReplace(false)
    },
    [replace],
  )

  const operator = useCallback(
    (op: Op) => {
      const current = Number.parseFloat(display)
      // Chained input resolves what came before, so 2 + 3 + shows 5 rather
      // than waiting for an equals that may never come.
      if (pending !== null && accumulator !== null && !replace) {
        const result = apply(accumulator, current, pending)
        setAccumulator(result)
        setDisplay(format(result))
      } else {
        setAccumulator(current)
      }
      setPending(op)
      setReplace(true)
    },
    [display, pending, accumulator, replace],
  )

  const equals = useCallback(() => {
    if (pending === null || accumulator === null) return
    const right = Number.parseFloat(display)
    const out = format(apply(accumulator, right, pending))
    record(`${format(accumulator)} ${pending} ${format(right)}`, out)
    setDisplay(out)
    setAccumulator(null)
    setPending(null)
    setReplace(true)
  }, [display, pending, accumulator, record])

  const unary = useCallback(
    (u: (typeof UNARY)[number]) => {
      const current = Number.parseFloat(display)
      const out = format(u.run(current))
      record(u.expr(format(current)), out)
      setDisplay(out)
      setReplace(true)
    },
    [display, record],
  )

  const negate = useCallback(() => {
    setDisplay(toggleSign)
  }, [])

  const constant = useCallback((value: number) => {
    setDisplay(format(value))
    setReplace(true)
  }, [])

  const clear = useCallback(() => {
    setDisplay('0')
    setAccumulator(null)
    setPending(null)
    setReplace(true)
  }, [])

  const backspace = useCallback(() => {
    setDisplay((prev) => {
      if (replace || prev.length <= 1 || (prev.length === 2 && prev.startsWith('-'))) return '0'
      return prev.slice(0, -1)
    })
  }, [replace])

  // A calculator you cannot type into is a calculator you will not use.
  //
  /** The pad's root, so `planCalculatorKey` can ask what a keystroke belongs to. */
  const root = useRef<HTMLDivElement>(null)

  // WHICH KEY MEANS WHAT lives in `calculator-keys`, not here. This listener is
  // on `window`, so its rules decide what happens to keystrokes aimed at the
  // rest of the page too — and the one that was wrong, an Enter cancelled out
  // from under whatever button or link had focus, was invisible from this file
  // and unreachable from a test while it was written inline.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The pad's own element goes with the keystroke: Enter and Escape belong
      // to whatever has focus, and the only way to tell the pad's buttons from
      // a sidebar link or an open dialog is to ask what contains the target.
      const plan = planCalculatorKey({
        key: e.key,
        target: e.target,
        within: root.current,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        defaultPrevented: e.defaultPrevented,
      })
      if (plan === null) return
      if (plan.preventDefault) e.preventDefault()

      switch (plan.action.kind) {
        case 'digit':
          return digit(plan.action.value)
        case 'operator':
          return operator(plan.action.op)
        case 'equals':
          return equals()
        case 'backspace':
          return backspace()
        case 'clear':
          return clear()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [digit, operator, equals, clear, backspace])

  const key =
    'grid h-11 cursor-pointer place-items-center rounded-md border text-sm transition-colors'
  const number = cn(key, 'border-hairline bg-panel text-text-1 hover:bg-row-hover')
  const action = cn(key, 'border-hairline bg-well text-text-2 hover:text-text-1')
  const sci = cn(key, 'h-9 border-hairline bg-well text-xs text-text-2 hover:text-text-1')
  const accent = cn(key, 'border-accent-border bg-accent text-[color:var(--accent-fg)]')

  /*
   * Plain functions called inline, not components declared in this render: a
   * component made per render is a new type each time, so every press
   * remounted the whole pad and the key you had Tabbed to lost focus to
   * `<body>` — the next Space scrolled the page instead of typing.
   */
  const digitKey = (d: string, className?: string) => (
    <button type="button" onClick={() => digit(d)} className={cn(number, className)}>
      {d}
    </button>
  )

  const operatorKey = (op: Op) => (
    <button
      type="button"
      onClick={() => operator(op)}
      aria-label={t(`calculator.ops.${OP_KEY[op]}`)}
      aria-pressed={pending === op}
      className={cn(action, 'font-medium')}
    >
      {op}
    </button>
  )

  return (
    // Side by side once history is open, wrapping to a stack when the row runs
    // out of width. `items-start` so the history panel is only as tall as its
    // own contents rather than stretching to match the keypad.
    <div ref={root} className="flex flex-wrap items-start gap-4 sm:gap-5">
      <Panel className="min-w-0 flex-1 basis-[320px] sm:max-w-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <PanelTitle className="mb-0">{t('instruments.calculator')}</PanelTitle>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
            aria-label={t('calculator.history')}
            title={t('calculator.history')}
            className={cn(
              'grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors',
              showHistory
                ? 'border-accent-border bg-accent-soft text-accent'
                : 'border-hairline bg-well text-text-2 hover:text-text-1',
            )}
          >
            <History className="size-3.5" strokeWidth={1.8} aria-hidden />
          </button>
        </div>

        <Segment label={t('calculator.mode')} options={modes} value={mode} onChange={setMode} />

        <output
          aria-live="polite"
          className="well mt-3 mb-3 block truncate rounded-md px-3 py-3 text-right font-mono text-2xl"
        >
          {display}
        </output>

        {mode === 'scientific' ? (
          <div className="mb-1.5 grid grid-cols-4 gap-1.5">
            {UNARY.map((u) => (
              <button key={u.key} type="button" onClick={() => unary(u)} className={sci}>
                {u.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => operator('^')}
              aria-label={t('calculator.ops.power')}
              className={sci}
            >
              xʸ
            </button>
            <button type="button" onClick={() => constant(Math.PI)} className={sci}>
              π
            </button>
            <button type="button" onClick={() => constant(Math.E)} className={sci}>
              e
            </button>
            <button
              type="button"
              onClick={negate}
              aria-label={t('calculator.plusMinus')}
              className={sci}
            >
              ±
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-1.5">
          <button type="button" onClick={clear} className={action}>
            C
          </button>
          <button
            type="button"
            onClick={backspace}
            aria-label={t('calculator.backspace')}
            className={action}
          >
            <Delete className="size-4" strokeWidth={1.8} aria-hidden />
          </button>
          {operatorKey('÷')}
          {operatorKey('×')}

          {digitKey('7')}
          {digitKey('8')}
          {digitKey('9')}
          {operatorKey('−')}

          {digitKey('4')}
          {digitKey('5')}
          {digitKey('6')}
          {operatorKey('+')}

          {digitKey('1')}
          {digitKey('2')}
          {digitKey('3')}
          {/* Equals spans two rows, the usual place the hand expects it. */}
          <button type="button" onClick={equals} className={cn(accent, 'row-span-2 h-auto')}>
            =
          </button>

          {digitKey('0', 'col-span-2')}
          {digitKey('.')}
        </div>
      </Panel>

      {showHistory ? (
        // Capped: left to grow it filled the whole remaining row for entries
        // that are a dozen characters long.
        <Panel className="min-w-0 flex-1 basis-[240px] sm:max-w-xs">
          <div className="mb-3 flex items-center justify-between gap-2">
            <PanelTitle className="mb-0">{t('calculator.history')}</PanelTitle>
            {history.length > 0 ? (
              <button
                type="button"
                onClick={() => setHistory([])}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-text-3 transition-colors hover:text-danger"
              >
                <Trash2 className="size-3" strokeWidth={1.8} aria-hidden />
                {t('calculator.clear')}
              </button>
            ) : null}
          </div>

          {history.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-3">{t('calculator.empty')}</p>
          ) : (
            <ul className="flex max-h-[26rem] flex-col overflow-y-auto">
              {history.map((h) => (
                <li key={h.id}>
                  {/* Reusable, not just readable — the reason to look at a past
                      result is almost always to carry it into the next sum. */}
                  <button
                    type="button"
                    onClick={() => {
                      setDisplay(h.value)
                      setReplace(true)
                    }}
                    title={t('calculator.use', { value: h.value })}
                    className="flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-sm px-1 py-1.5 text-start transition-colors hover:bg-well"
                  >
                    <span className="min-w-0 truncate font-mono text-xs text-text-3">{h.expr}</span>
                    <span className="shrink-0 font-mono text-sm text-text-1">{h.value}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  )
}
