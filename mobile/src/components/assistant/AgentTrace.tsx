import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useTranslation } from 'react-i18next'
import type { AgentStep } from '@jojo/service/agent/loop'
import { readStepDetail } from '@jojo/service/agent/execute'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Txt } from '@/components/ui/Text'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * One tool call, as it happens.
 *
 * The web copy of this carries the argument for the design; what is different
 * here is only what a phone forces. There is no hover and no wide gutter, so the
 * whole row is the disclosure target rather than a chevron, and the argument
 * dump gets its own horizontal scroller because a 200-character JSON line
 * cannot wrap into 380 points without becoming unreadable.
 *
 * Collapsed by default for the same reason as on the web: the useful half is the
 * sentence `describe` already wrote for the toast.
 */

type StatusLook = {
  icon: string
  colour: (c: ReturnType<typeof useColors>) => string
  label: string
}

const STATUS: Record<AgentStep['status'], StatusLook> = {
  running: { icon: 'loader', colour: (c) => c.text3, label: 'trace.status.running' },
  done: { icon: 'check', colour: (c) => c.success, label: 'trace.status.done' },
  failed: { icon: 'x', colour: (c) => c.danger, label: 'trace.status.failed' },
  declined: { icon: 'slash', colour: (c) => c.warning, label: 'trace.status.declined' },
}

/** A read is grey and everything that writes is not. Delete is red. */
const EFFECT: Record<
  AgentStep['effect'],
  { tone: 'gray' | 'teal' | 'amber' | 'red'; label: string }
> = {
  read: { tone: 'gray', label: 'trace.effect.read' },
  // A tool that does not exist. Amber rather than grey: it is not a harmless
  // read, it is a call that never had a meaning.
  unknown: { tone: 'amber', label: 'trace.effect.unknown' },
  create: { tone: 'teal', label: 'trace.effect.create' },
  update: { tone: 'teal', label: 'trace.effect.update' },
  move: { tone: 'teal', label: 'trace.effect.move' },
  delete: { tone: 'red', label: 'trace.effect.delete' },
  admin: { tone: 'red', label: 'trace.effect.admin' },
}

/** Whether a step changed anything — the same rule web's trace uses. */
const wrote = (effect: AgentStep['effect']): boolean => effect !== 'read' && effect !== 'unknown'

export function StepRow({
  step,
  onUndo,
  pending,
}: {
  step: AgentStep
  onUndo?: (step: AgentStep) => void
  /** Set when this step is waiting on a decision. Renders the two buttons. */
  pending?: { allow: () => void; decline: () => void }
}) {
  const { t } = useTranslation('components')
  const c = useColors()
  const [open, setOpen] = useState(false)
  const status = STATUS[step.status]
  const effect = EFFECT[step.effect]

  return (
    <View style={{ borderWidth: 1, borderColor: c.hairline, borderRadius: radius.lg }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${step.title}, ${t(status.label)}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((v) => !v)
        }}
        style={{ padding: space[3], gap: space[1] }}
      >
        <View style={[s.row, { gap: space[2] }]}>
          {step.status === 'running' ? (
            <ActivityIndicator size="small" color={c.text3} />
          ) : (
            <Feather name={status.icon as never} size={16} color={status.colour(c)} />
          )}
          <Txt size="sm" weight="medium" numberOfLines={1} style={s.fill}>
            {step.title}
          </Txt>
          <Chip tone={effect.tone} size="sm">
            {t(effect.label)}
          </Chip>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={c.text3} />
        </View>

        {/* The registry name: the title alone does not say WHICH tool ran, and
            the two are not one-to-one — five tools are some form of "Update". */}
        <Txt size="xs" tone="muted" mono numberOfLines={1}>
          {step.name}
        </Txt>

        {step.announcement ? (
          <Txt size="xs" tone="secondary">
            {step.announcement.title}
            {step.announcement.description ? ` — ${step.announcement.description}` : ''}
          </Txt>
        ) : step.status === 'failed' || step.status === 'declined' ? (
          <Txt size="xs" tone="danger">
            {step.detail}
          </Txt>
        ) : null}
      </Pressable>

      {/* The approval gate, inline on the step it is about. A sheet here would
          cover the list of what else the agent has done, which is the context
          needed to answer. */}
      {pending ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.hairline,
            padding: space[3],
            gap: space[2],
          }}
        >
          <View style={[s.row, { gap: space[2] }]}>
            <Feather name="alert-triangle" size={16} color={c.warning} />
            <Txt size="xs" tone="secondary" style={s.fill}>
              {t('trace.asked')}
            </Txt>
          </View>
          <View style={[s.row, { justifyContent: 'flex-end', gap: space[2] }]}>
            <Button label={t('trace.dont')} variant="outline" onPress={pending.decline} />
            <Button label={t('trace.allow')} onPress={pending.allow} />
          </View>
        </View>
      ) : null}

      {open ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.hairline,
            padding: space[3],
            gap: space[2],
          }}
        >
          <Detail label={t('trace.arguments')} value={JSON.stringify(step.args, null, 2)} />
          <Result step={step} />
        </View>
      ) : null}

      {/* Undo stays available after the run has finished. An agent whose work
          cannot be taken back once it has stopped running is one nobody should
          let write. */}
      {step.status === 'done' && step.undo && onUndo ? (
        <View
          style={{ borderTopWidth: 1, borderTopColor: c.hairline, paddingHorizontal: space[2] }}
        >
          <Button
            label={t('trace.undoStep')}
            icon="rotate-ccw"
            variant="ghost"
            onPress={() => {
              onUndo(step)
            }}
          />
        </View>
      ) : step.status === 'done' && wrote(step.effect) ? (
        /* See web's `AgentTrace.tsx`: `step.undo` is a closure and does not
           survive a reload, so a reopened conversation used to render the same
           trace with the undo quietly missing and nothing to say why. */
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.hairline,
            paddingHorizontal: space[2],
            paddingVertical: space[1.5],
          }}
        >
          <Txt size="xs" tone="muted">
            {t('trace.cannotUndo')}
          </Txt>
        </View>
      ) : null}
    </View>
  )
}

/**
 * A step's result, laid out rather than dumped.
 *
 * `detail` is one string carrying two different things — a read comes back as
 * compact JSON, a write as the toast sentence — and rendering both the same way
 * made a read of forty records one 6000-character line. `readStepDetail` tells
 * them apart with the same predicate that chose the format.
 */
function Result({ step }: { step: AgentStep }) {
  const { t } = useTranslation('components')
  const detail = readStepDetail(step)
  if (!detail) return null
  if (detail.kind === 'text') return <Detail label={t('trace.result')} value={detail.value} />
  return (
    <Detail
      label={t('trace.result')}
      value={JSON.stringify(detail.value, null, 2)}
      {...(detail.truncated ? { note: t('trace.truncated') } : {})}
    />
  )
}

function Detail({ label, value, note }: { label: string; value: string; note?: string }) {
  const c = useColors()
  return (
    <View style={{ gap: space[1] }}>
      <Txt size="xs" tone="muted" weight="medium">
        {label}
      </Txt>
      {/*
       * VERTICAL, not horizontal, and that is a bug fix rather than a
       * preference. This was a `horizontal` ScrollView with a 180pt cap — and a
       * horizontal ScrollView does not scroll vertically, so everything past
       * about ten lines was clipped with no way to reach it. Pretty-printed
       * arguments already hit that; a pretty-printed result would bury it.
       *
       * The trade the old comment was making is real but points the other way
       * now: pretty-printed JSON is mostly short indented lines, so wrapping
       * costs little, while losing the tail costs everything. `nestedScroll`
       * is what lets this scroll inside the screen's own ScrollView.
       */}
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: 220, backgroundColor: c.well, borderRadius: radius.md }}
        contentContainerStyle={{ padding: space[2] }}
      >
        <Txt size="xs" tone="secondary" mono selectable>
          {value}
        </Txt>
      </ScrollView>
      {note ? (
        <Txt size="xs" tone="muted">
          {note}
        </Txt>
      ) : null}
    </View>
  )
}

/** Shown while the model is deciding what to do, before any step exists. */
export function Thinking({ model }: { model: string }) {
  const { t } = useTranslation('components')
  const c = useColors()
  return (
    <View
      style={[
        s.row,
        {
          gap: space[2],
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: c.hairline,
          borderRadius: radius.lg,
          padding: space[3],
        },
      ]}
    >
      <ActivityIndicator size="small" color={c.text3} />
      <Txt size="sm" tone="muted" numberOfLines={1} style={s.fill}>
        {t('trace.thinking', { model })}
      </Txt>
    </View>
  )
}
