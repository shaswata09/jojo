import { useMemo } from 'react'
import { QUERY_EXAMPLES } from '@/lib/graph/examples'
import type { Graph } from '@/lib/graph/model'
import type { GraphQuery } from '@/lib/graph/query'
import { cn } from '@/lib/utils'

/**
 * The worked examples, as a row of chips.
 *
 * Each one is built against the graph in front of it, so a chip this session
 * has nothing to ask is disabled and says why in its title — a button that
 * returned an empty table would look like the answer was "none".
 */
export function ExampleChips({
  graph,
  query,
  onQueryChange,
}: {
  graph: Graph
  query: GraphQuery | null
  onQueryChange: (query: GraphQuery) => void
}) {
  const examples = useMemo(
    () => QUERY_EXAMPLES.map((example) => ({ ...example, built: example.build(graph) })),
    [graph],
  )

  return (
    <div>
      <h3 className="mb-1.5 text-xs text-text-3">Worked examples</h3>
      <ul className="flex flex-wrap gap-1.5">
        {examples.map((example) => {
          const on = query !== null && example.built !== null && sameQuery(query, example.built)
          return (
            <li key={example.id}>
              <button
                type="button"
                disabled={example.built === null}
                title={
                  example.built === null ? 'This session has nothing to ask that of' : example.hint
                }
                onClick={() => example.built && onQueryChange(example.built)}
                className={cn(
                  'pressable rounded-full border px-2.5 py-1 text-xs transition-colors',
                  on
                    ? 'border-accent-border bg-accent-soft text-accent'
                    : 'border-hairline bg-well text-text-2 hover:border-hairline-strong hover:text-text-1',
                  example.built === null && 'cursor-not-allowed opacity-50',
                )}
              >
                {example.label}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Cheap structural equality — enough to light up the example you pressed. */
function sameQuery(a: GraphQuery, b: GraphQuery) {
  return JSON.stringify(a) === JSON.stringify(b)
}
