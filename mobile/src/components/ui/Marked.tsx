import { useMemo } from 'react'
import { Text, View } from 'react-native'
import { MARK_LEGEND, parseMarks } from '@jojo/service/core/marks'
import type { Block, Run } from '@jojo/service/core/marks'
import { Txt } from '@/components/ui/Text'
import { useColors } from '@/theme/theme-context'
import { fonts, space } from '@/theme/tokens'

/**
 * A tailored snippet's body, with its marks drawn. The phone's half of web's
 * `common/Marked.tsx`; the parser is `core/marks.ts` and this is only the
 * drawing.
 *
 * Bold is a font FILE here, not a style — see `tokens.ts` on why `fontWeight`
 * does nothing with these PostScript-named faces — so a bold run switches to
 * Inter-SemiBold. Italic is OS-synthesised (`fontStyle`), as the assistant's
 * transcript already does; there is no italic face linked and a run that reads
 * a little flat is better than one that reads in the wrong family.
 */

function Runs({ runs }: { runs: readonly Run[] }) {
  const c = useColors()
  return (
    <>
      {runs.map((r, i) => (
        <Text
          key={i}
          style={{
            ...(r.bold ? { fontFamily: fonts.semibold, backgroundColor: c.accentSoft } : {}),
            ...(r.italic ? { fontStyle: 'italic' as const } : {}),
            ...(r.underline ? { textDecorationLine: 'underline' as const } : {}),
          }}
        >
          {r.text}
        </Text>
      ))}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'blank') return <View style={{ height: space[2] }} />
  if (block.kind === 'heading') {
    if (block.level === 3) {
      return (
        <Txt size="xs" tone="muted" uppercase style={{ marginTop: space[2] }}>
          <Runs runs={block.runs} />
        </Txt>
      )
    }
    return (
      <Txt
        size={block.level === 1 ? 'md' : 'base'}
        weight="semibold"
        style={{ marginTop: space[3] }}
      >
        <Runs runs={block.runs} />
      </Txt>
    )
  }
  return (
    <Txt size="sm" tone="secondary">
      <Runs runs={block.runs} />
    </Txt>
  )
}

export function Marked({ body }: { body: string }) {
  const blocks = useMemo(() => parseMarks(body), [body])
  return (
    <View style={{ gap: 2 }}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </View>
  )
}

/** What the three marks mean, in one line under a list of tailored documents. */
export function MarksLegend() {
  const c = useColors()
  return (
    <Txt size="xs" tone="muted">
      <Text style={{ fontFamily: fonts.semibold, backgroundColor: c.accentSoft }}>bold</Text>{' '}
      {MARK_LEGEND.bold} · <Text style={{ fontStyle: 'italic' }}>italic</Text> {MARK_LEGEND.italic}{' '}
      · <Text style={{ textDecorationLine: 'underline' }}>underlined</Text> {MARK_LEGEND.underline}
    </Txt>
  )
}
