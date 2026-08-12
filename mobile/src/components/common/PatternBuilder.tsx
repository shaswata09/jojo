import { useState } from 'react'
import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { MenuSheet } from '@/components/ui/Menu'
import { Txt } from '@/components/ui/Text'
import { GRAPH_NODE_TYPES, GRAPH_RELS, NODE_TYPE_LABEL, REL_LABEL } from '@/lib/graph'
import type { GraphNodeType, GraphRel, PatternQuery, Quantifier } from '@/lib/graph'
import { s } from '@/theme/styles'
import { space } from '@/theme/tokens'

/**
 * Asking the graph something the example list did not think of.
 *
 * The web app draws this as a row of inline selects reading like a sentence.
 * There is no room for four controls on one line at 360pt, so each is a full
 * row that opens the app's standard menu sheet — the same control the stage
 * picker and the bucket mover use, which means the picking gesture is already
 * learned by the time anyone gets here.
 *
 * Every change runs immediately. A Run button would create a state where the
 * answer on screen and the question above it disagree, and that state is the
 * one people screenshot.
 */

type Field = 'start' | 'quantifier' | 'rel' | 'end' | null

const QUANTIFIERS: { value: Quantifier; label: string; hint: string }[] = [
  { value: 'has', label: 'that have', hint: 'At least one such link' },
  { value: 'missing', label: 'that do not have', hint: 'No such link at all' },
]

export function PatternBuilder({
  value,
  onChange,
}: {
  value: PatternQuery
  onChange: (next: PatternQuery) => void
}) {
  const [open, setOpen] = useState<Field>(null)

  const nodeOptions = (field: 'start' | 'end') => [
    {
      id: 'any',
      label: 'Anything',
      checked: value[field] === 'any',
      onPress: () => onChange({ ...value, [field]: 'any' }),
    },
    ...GRAPH_NODE_TYPES.map((t) => ({
      id: t,
      label: NODE_TYPE_LABEL[t],
      checked: value[field] === t,
      onPress: () => onChange({ ...value, [field]: t as GraphNodeType }),
    })),
  ]

  const rows: { field: Exclude<Field, null>; label: string; value: string }[] = [
    {
      field: 'start',
      label: 'Look for',
      value: value.start === 'any' ? 'Anything' : NODE_TYPE_LABEL[value.start],
    },
    {
      field: 'quantifier',
      label: 'Records',
      value: QUANTIFIERS.find((q) => q.value === value.quantifier)!.label,
    },
    {
      field: 'rel',
      label: 'A link',
      value: value.rel === 'any' ? 'Of any kind' : REL_LABEL[value.rel],
    },
    {
      field: 'end',
      label: 'To',
      value: value.end === 'any' ? 'Anything' : NODE_TYPE_LABEL[value.end],
    },
  ]

  return (
    <View style={{ gap: space[2] }}>
      {rows.map((r) => (
        <View key={r.field} style={s.row}>
          <Txt size="sm" tone="secondary" style={s.fill}>
            {r.label}
          </Txt>
          <Button label={r.value} variant="outline" onPress={() => setOpen(r.field)} />
        </View>
      ))}

      <MenuSheet
        open={open === 'start'}
        onClose={() => setOpen(null)}
        title="Look for"
        description="The kind of record the answer is a list of."
        actions={nodeOptions('start')}
      />
      <MenuSheet
        open={open === 'quantifier'}
        onClose={() => setOpen(null)}
        title="Having, or missing"
        description="Whether the link below has to be there or has to be absent."
        actions={QUANTIFIERS.map((q) => ({
          id: q.value,
          label: q.label,
          hint: q.hint,
          checked: value.quantifier === q.value,
          onPress: () => onChange({ ...value, quantifier: q.value }),
        }))}
      />
      <MenuSheet
        open={open === 'rel'}
        onClose={() => setOpen(null)}
        title="Which link"
        description="How the two ends are joined. “Of any kind” asks about all six at once."
        actions={[
          {
            id: 'any',
            label: 'Of any kind',
            checked: value.rel === 'any',
            onPress: () => onChange({ ...value, rel: 'any' }),
          },
          ...GRAPH_RELS.map((r) => ({
            id: r,
            label: REL_LABEL[r],
            hint: r,
            checked: value.rel === r,
            onPress: () => onChange({ ...value, rel: r as GraphRel }),
          })),
        ]}
      />
      <MenuSheet
        open={open === 'end'}
        onClose={() => setOpen(null)}
        title="At the other end"
        description="What the link has to point at."
        actions={nodeOptions('end')}
      />
    </View>
  )
}
