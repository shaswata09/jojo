import { useCallback, useEffect, useState } from 'react'
import { Delete, History, Trash2 } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { cn } from '@/lib/utils'
import { UNARY, apply, format, toggleSign } from '@jojo/service/core/calculator'
import type { Op } from '@jojo/service/core/calculator'
// `MAX_DIGITS` is imported rather than redeclared: the keypad caps typed input
// at the same width the shared `format` caps output at, and the two drifting
// apart would let someone type a number the display could not print back.
import { MAX_DIGITS } from '@jojo/service/core/calculator'

/** History is a short memory, not an audit log. */
const MAX_HISTORY = 30

const MODES = [
  { value: 'basic', label: 'Basic' },
  { value: 'scientific', label: 'Scientific' },
] as const
type Mode = (typeof MODES)[number]['value']

type Entry = { id: number; expr: string; value: string }

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
  const [display, setDisplay] = useState('0')
  /** The left-hand side of a pending operation, held while the right is typed. */
  const [accumulator, setAccumulator] = useState<number | null>(null)
  const [pending, setPending] = useState<Op | null>(null)
  /** True once a result or operator has landed, so the next digit starts fresh. */
  const [replace, setReplace] = useState(true)

  const [mode, setMode] = useState<Mode>('basic')
  const [history, setHistory] = useState<Entry[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const record = useCallback((expr: string, value: string) => {
    setHistory((prev) =>
      [{ id: prev.length ? prev[0].id + 1 : 1, expr, value }, ...prev].slice(0, MAX_HISTORY),
    )
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      // Never swallow keys meant for a field elsewhere on the page.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return

      if (/^[0-9]$/.test(e.key) || e.key === '.') return digit(e.key)
      if (e.key === '+') return operator('+')
      if (e.key === '-') return operator('−')
      if (e.key === '*') return operator('×')
      if (e.key === '^') return operator('^')
      if (e.key === '/') return (e.preventDefault(), operator('÷'))
      if (e.key === 'Enter' || e.key === '=') return (e.preventDefault(), equals())
      if (e.key === 'Backspace') return (e.preventDefault(), backspace())
      if (e.key === 'Escape') return clear()
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

  const Digit = ({ d, className }: { d: string; className?: string }) => (
    <button type="button" onClick={() => digit(d)} className={cn(number, className)}>
      {d}
    </button>
  )

  const Operator = ({ op }: { op: Op }) => (
    <button
      type="button"
      onClick={() => operator(op)}
      aria-label={
        { '+': 'plus', '−': 'minus', '×': 'times', '÷': 'divided by', '^': 'to the power of' }[op]
      }
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
    <div className="flex flex-wrap items-start gap-4 sm:gap-5">
      <Panel className="min-w-0 flex-1 basis-[320px] sm:max-w-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <PanelTitle className="mb-0">Calculator</PanelTitle>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-pressed={showHistory}
            aria-label="History"
            title="History"
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

        <Segment label="Calculator mode" options={MODES} value={mode} onChange={setMode} />

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
              aria-label="to the power of"
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
            <button type="button" onClick={negate} aria-label="plus or minus" className={sci}>
              ±
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-1.5">
          <button type="button" onClick={clear} className={action}>
            C
          </button>
          <button type="button" onClick={backspace} aria-label="Backspace" className={action}>
            <Delete className="size-4" strokeWidth={1.8} aria-hidden />
          </button>
          <Operator op="÷" />
          <Operator op="×" />

          <Digit d="7" />
          <Digit d="8" />
          <Digit d="9" />
          <Operator op="−" />

          <Digit d="4" />
          <Digit d="5" />
          <Digit d="6" />
          <Operator op="+" />

          <Digit d="1" />
          <Digit d="2" />
          <Digit d="3" />
          {/* Equals spans two rows, the usual place the hand expects it. */}
          <button type="button" onClick={equals} className={cn(accent, 'row-span-2 h-auto')}>
            =
          </button>

          <Digit d="0" className="col-span-2" />
          <Digit d="." />
        </div>
      </Panel>

      {showHistory ? (
        // Capped: left to grow it filled the whole remaining row for entries
        // that are a dozen characters long.
        <Panel className="min-w-0 flex-1 basis-[240px] sm:max-w-xs">
          <div className="mb-3 flex items-center justify-between gap-2">
            <PanelTitle className="mb-0">History</PanelTitle>
            {history.length > 0 ? (
              <button
                type="button"
                onClick={() => setHistory([])}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-text-3 transition-colors hover:text-danger"
              >
                <Trash2 className="size-3" strokeWidth={1.8} aria-hidden />
                Clear
              </button>
            ) : null}
          </div>

          {history.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-3">
              Nothing yet. Finished calculations land here.
            </p>
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
                    title={`Use ${h.value}`}
                    className="flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-well"
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
