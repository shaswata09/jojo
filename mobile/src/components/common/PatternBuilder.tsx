import { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
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
  { value: 'has', label: 'pattern.has', hint: 'pattern.hasHint' },
  { value: 'missing', label: 'pattern.missing', hint: 'pattern.missingHint' },
]

export function PatternBuilder({
  value,
  onChange,
}: {
  value: PatternQuery
  onChange: (next: PatternQuery) => void
}) {
  const { t } = useTranslation('components')
  const [open, setOpen] = useState<Field>(null)

  const nodeOptions = (field: 'start' | 'end') => [
    {
      id: 'any',
      label: t('pattern.anything'),
      checked: value[field] === 'any',
      onPress: () => onChange({ ...value, [field]: 'any' }),
    },
    ...GRAPH_NODE_TYPES.map((type) => ({
      id: type,
      label: NODE_TYPE_LABEL[type],
      checked: value[field] === type,
      onPress: () => onChange({ ...value, [field]: type as GraphNodeType }),
    })),
  ]

  const rows: { field: Exclude<Field, null>; label: string; value: string }[] = [
    {
      field: 'start',
      label: t('pattern.lookFor'),
      value: value.start === 'any' ? t('pattern.anything') : NODE_TYPE_LABEL[value.start],
    },
    {
      field: 'quantifier',
      label: t('pattern.records'),
      value: t(QUANTIFIERS.find((q) => q.value === value.quantifier)!.label),
    },
    {
      field: 'rel',
      label: t('pattern.aLink'),
      value: value.rel === 'any' ? t('pattern.anyKind') : REL_LABEL[value.rel],
    },
    {
      field: 'end',
      label: t('pattern.to'),
      value: value.end === 'any' ? t('pattern.anything') : NODE_TYPE_LABEL[value.end],
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
        title={t('pattern.lookFor')}
        description={t('pattern.lookForHint')}
        actions={nodeOptions('start')}
      />
      <MenuSheet
        open={open === 'quantifier'}
        onClose={() => setOpen(null)}
        title={t('pattern.quantifierTitle')}
        description={t('pattern.quantifierHint')}
        actions={QUANTIFIERS.map((q) => ({
          id: q.value,
          label: t(q.label),
          hint: t(q.hint),
          checked: value.quantifier === q.value,
          onPress: () => onChange({ ...value, quantifier: q.value }),
        }))}
      />
      <MenuSheet
        open={open === 'rel'}
        onClose={() => setOpen(null)}
        title={t('pattern.relTitle')}
        description={t('pattern.relHint')}
        actions={[
          {
            id: 'any',
            label: t('pattern.anyKind'),
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
        title={t('pattern.endTitle')}
        description={t('pattern.endHint')}
        actions={nodeOptions('end')}
      />
    </View>
  )
}
