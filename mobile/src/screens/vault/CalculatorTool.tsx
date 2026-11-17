import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Segment } from '@/components/ui/Segment'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { UNARY, apply, format, toggleSign } from '@jojo/service/core/calculator'
import type { Op } from '@jojo/service/core/calculator'
import { useCopy } from '@/lib/use-copy'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space } from '@/theme/tokens'

/** Labelled by `calculator.modes.<value>` in the vault catalog. */
const MODES = ['basic', 'scientific'] as const
type Mode = (typeof MODES)[number]

/** History is a short memory, not an audit log. */
const MAX_HISTORY = 30

type Entry = { id: number; expr: string; value: string }

/**
 * The Vault's instrument, rather than its records.
 *
 * A job search does more arithmetic than anyone expects — a nine-month academic
 * salary against a twelve-month industry one, a relocation against a startup
 * package, a percentage of a stipend — and every one of those is a moment where
 * a person leaves the app to find a calculator and comes back having lost their
 * place. It keeps a short history because the second number is almost always
 * compared against the first.
 *
 * The arithmetic lives in `@jojo/service/core/calculator`, shared with web; this
 * is the keypad.
 */
export function CalculatorTool() {
  const { t } = useTranslation('vault')
  const c = useColors()
  const { copy, isCopied } = useCopy()

  const [mode, setMode] = useState<Mode>('basic')
  /** What the display shows. Always a string: '0.' is a valid thing to be typing. */
  const [display, setDisplay] = useState('0')
  /** The left-hand operand, held while the right-hand one is typed. */
  const [pending, setPending] = useState<{ value: number; op: Op } | null>(null)
  /** True while the next digit should replace the display rather than extend it. */
  const [fresh, setFresh] = useState(true)
  const [history, setHistory] = useState<Entry[]>([])
  const [nextId, setNextId] = useState(0)

  const record = (expr: string, value: string) => {
    setHistory((prev) => [{ id: nextId, expr, value }, ...prev].slice(0, MAX_HISTORY))
    setNextId((n) => n + 1)
  }

  const digit = (d: string) => {
    setDisplay((prev) => {
      if (fresh) return d === '.' ? '0.' : d
      if (d === '.' && prev.includes('.')) return prev
      if (prev === '0' && d !== '.') return d
      return prev + d
    })
    setFresh(false)
  }

  const operator = (op: Op) => {
    const current = Number(display)
    if (pending && !fresh) {
      // Chained without pressing equals — resolve what is waiting first, so
      // 2 + 3 × 4 shows 5 the moment × is pressed rather than silently holding
      // two operations the display cannot express.
      const result = apply(pending.value, current, pending.op)
      setDisplay(format(result))
      setPending({ value: result, op })
    } else {
      setPending({ value: current, op })
    }
    setFresh(true)
  }

  const equals = () => {
    if (!pending) return
    const current = Number(display)
    const result = apply(pending.value, current, pending.op)
    const expr = `${format(pending.value)} ${pending.op} ${format(current)}`
    setDisplay(format(result))
    record(expr, format(result))
    setPending(null)
    setFresh(true)
  }

  const unary = (key: string) => {
    const fn = UNARY.find((u) => u.key === key)
    if (!fn) return
    const current = Number(display)
    const result = fn.run(current)
    setDisplay(format(result))
    record(fn.expr(format(current)), format(result))
    setFresh(true)
  }

  const clear = () => {
    setDisplay('0')
    setPending(null)
    setFresh(true)
  }

  /** One character back. `0` rather than an empty display, which cannot be typed into. */
  const backspace = () => {
    setDisplay((prev) => (prev.length <= 1 ? '0' : prev.slice(0, -1)))
    setFresh(false)
  }

  const Key = ({
    label,
    onPress,
    variant = 'plain',
    wide,
  }: {
    label: string
    onPress: () => void
    variant?: 'plain' | 'op' | 'accent'
    wide?: boolean
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        wide && styles.keyWide,
        {
          backgroundColor:
            variant === 'accent' ? c.accent : variant === 'op' ? c.accentSoft : c.well,
          borderColor: variant === 'accent' ? c.accent : c.hairline,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Txt
        size="lg"
        weight="medium"
        color={variant === 'accent' ? c.accentFg : variant === 'op' ? c.accent : c.text1}
      >
        {label}
      </Txt>
    </Pressable>
  )

  return (
    <>
      <Panel>
        <PanelTitle
          hint={t('calculator.hint')}
          right={
            <IconButton
              icon={isCopied('display') ? 'check' : 'copy'}
              label={t('calculator.copy')}
              active={isCopied('display')}
              onPress={() => copy(display, 'display')}
            />
          }
        >
          {t('calculator.title')}
        </PanelTitle>

        <Segment
          label={t('calculator.mode')}
          options={MODES.map((value) => ({ value, label: t(`calculator.modes.${value}`) }))}
          value={mode}
          onChange={setMode}
        />

        {/* The pending operation is shown above the display rather than
            inferred: without it, pressing 5 after "2 +" looks identical to
            starting again, and the difference is the whole of the result. */}
        <View style={[styles.display, { backgroundColor: c.well, borderColor: c.hairline }]}>
          <Txt size="xs" tone="muted" mono style={styles.pending}>
            {pending ? `${format(pending.value)} ${pending.op}` : ' '}
          </Txt>
          <Txt
            size="xxl"
            weight="semibold"
            mono
            numberOfLines={1}
            adjustsFontSizeToFit
            style={styles.result}
            accessibilityLiveRegion="polite"
          >
            {display}
          </Txt>
        </View>

        {mode === 'scientific' ? (
          <View style={styles.sciGrid}>
            {UNARY.map((u) => (
              <Pressable
                key={u.key}
                accessibilityRole="button"
                accessibilityLabel={u.label}
                onPress={() => unary(u.key)}
                style={({ pressed }) => [
                  styles.sciKey,
                  { backgroundColor: pressed ? c.rowHover : c.well, borderColor: c.hairline },
                ]}
              >
                <Txt size="sm" weight="medium" tone="secondary">
                  {u.label}
                </Txt>
              </Pressable>
            ))}
            {/* Explicit rather than a `UNARY` row: `±` edits the display and
                records nothing, which is not what the entries in that table do.
                It used to be one of them, which is why pressing it here filled
                the history with sign flips. See `core/calculator.ts`. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('calculator.plusMinus')}
              onPress={() => setDisplay(toggleSign)}
              style={({ pressed }) => [
                styles.sciKey,
                { backgroundColor: pressed ? c.rowHover : c.well, borderColor: c.hairline },
              ]}
            >
              <Txt size="sm" weight="medium" tone="secondary">
                ±
              </Txt>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.pad}>
          <Key label="C" onPress={clear} variant="op" />
          <Key label="⌫" onPress={backspace} variant="op" />
          <Key label="^" onPress={() => operator('^')} variant="op" />
          <Key label="÷" onPress={() => operator('÷')} variant="op" />

          <Key label="7" onPress={() => digit('7')} />
          <Key label="8" onPress={() => digit('8')} />
          <Key label="9" onPress={() => digit('9')} />
          <Key label="×" onPress={() => operator('×')} variant="op" />

          <Key label="4" onPress={() => digit('4')} />
          <Key label="5" onPress={() => digit('5')} />
          <Key label="6" onPress={() => digit('6')} />
          <Key label="−" onPress={() => operator('−')} variant="op" />

          <Key label="1" onPress={() => digit('1')} />
          <Key label="2" onPress={() => digit('2')} />
          <Key label="3" onPress={() => digit('3')} />
          <Key label="+" onPress={() => operator('+')} variant="op" />

          <Key label="0" onPress={() => digit('0')} wide />
          <Key label="." onPress={() => digit('.')} />
          <Key label="=" onPress={equals} variant="accent" />
        </View>
      </Panel>

      <Panel>
        <PanelTitle
          hint={history.length > 0 ? t('calculator.kept', { count: history.length }) : undefined}
          right={
            history.length > 0 ? (
              <Button
                label={t('calculator.clear')}
                variant="ghost"
                onPress={() => setHistory([])}
              />
            ) : undefined
          }
        >
          {t('calculator.history')}
        </PanelTitle>

        {history.length === 0 ? (
          <EmptyState
            compact
            icon="clock"
            title={t('calculator.emptyTitle')}
            description={t('calculator.emptyDescription')}
          />
        ) : (
          <ScrollView style={styles.history} bounces={false}>
            {history.map((entry, i) => (
              <View key={entry.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('calculator.historyEntry', {
                    expr: entry.expr,
                    value: entry.value,
                  })}
                  onPress={() => {
                    setDisplay(entry.value)
                    setFresh(true)
                  }}
                  style={({ pressed }) => [
                    styles.historyRow,
                    pressed && { backgroundColor: c.rowHover },
                  ]}
                >
                  <Txt size="sm" tone="muted" mono style={s.fill} numberOfLines={1}>
                    {entry.expr}
                  </Txt>
                  <Txt size="sm" mono>
                    {entry.value}
                  </Txt>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
      </Panel>
    </>
  )
}

const styles = StyleSheet.create({
  display: {
    marginTop: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space[3.5],
    paddingVertical: space[3],
  },
  pending: { textAlign: 'right', fontFamily: fonts.mono },
  result: { textAlign: 'right' },
  sciGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1.5], marginTop: space[3] },
  sciKey: {
    width: '18%',
    flexGrow: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
  key: {
    width: '22%',
    flexGrow: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  keyWide: { width: '46%' },
  history: { maxHeight: 260 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 44,
    paddingHorizontal: space[1],
  },
})
