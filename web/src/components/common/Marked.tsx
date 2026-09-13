import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { MARK_LEGEND, parseMarks } from '@jojo/service/core/marks'
import type { Block, Run } from '@jojo/service/core/marks'
import { cn } from '@/lib/utils'

/**
 * A tailored snippet's body, with its marks drawn.
 *
 * The parser is `core/marks.ts` and this is only the drawing: bold on a soft
 * accent so a changed passage can be found by scanning, italic for reworded,
 * underline for moved up, and three heading sizes. Used ONLY where the record
 * says a model wrote the body (`SnippetProps.tailored`) — a hand-written
 * snippet is plain text and stays so, underscores and all.
 */

function Runs({ runs }: { runs: readonly Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: ReactNode = r.text
        if (r.underline)
          node = <u className="underline decoration-accent underline-offset-2">{node}</u>
        if (r.italic) node = <em>{node}</em>
        if (r.bold) {
          node = (
            <strong className="rounded-sm bg-accent-soft px-0.5 font-semibold text-text-1">
              {node}
            </strong>
          )
        }
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'blank') return <div className="h-3" aria-hidden />
  if (block.kind === 'heading') {
    if (block.level === 1) {
      return (
        <h3 className="mt-3 text-base font-semibold text-text-1">
          <Runs runs={block.runs} />
        </h3>
      )
    }
    if (block.level === 2) {
      return (
        <h4 className="mt-3 text-sm font-semibold text-text-1">
          <Runs runs={block.runs} />
        </h4>
      )
    }
    return (
      <h5 className="mt-2 text-xs font-medium tracking-wide text-text-3 uppercase">
        <Runs runs={block.runs} />
      </h5>
    )
  }
  return (
    <p className="whitespace-pre-wrap">
      <Runs runs={block.runs} />
    </p>
  )
}

export function Marked({ body, className }: { body: string; className?: string }) {
  const blocks = useMemo(() => parseMarks(body), [body])
  return (
    <div className={cn('text-sm leading-relaxed text-text-2', className)}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  )
}

/** What the three marks mean, in one line under a list of tailored documents. */
export function MarksLegend({ className }: { className?: string }) {
  return (
    <p className={cn('text-xs text-text-3', className)}>
      <strong className="rounded-sm bg-accent-soft px-0.5 font-semibold text-text-1">bold</strong>{' '}
      {MARK_LEGEND.bold} · <em>italic</em> {MARK_LEGEND.italic} ·{' '}
      <u className="underline decoration-accent underline-offset-2">underlined</u>{' '}
      {MARK_LEGEND.underline}
    </p>
  )
}
