import { useMemo, useState } from 'react'
import { ArrowUpRight, MousePointerClick } from 'lucide-react'
import { Link } from 'react-router'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { ToolRunDialog } from '@/components/common/ToolRunDialog'
import { planToolForm } from '@/components/common/tool-form'
import type { FormPlan } from '@/components/common/tool-form'
import { Button } from '@/components/ui/button'
import type { NodeType } from '@/kg/core/model'
import { useGraph, useKg } from '@/kg/react/kg-context'
import type { ToolName } from '@/kg/tools'
import { NODE_TYPE_LABEL, REL_LABEL } from '@/lib/graph/model'
import type { Graph, GraphNode, GraphRel } from '@/lib/graph/model'
import { incidentEdges, otherEnd } from '@/lib/graph/traversal'
import { TypeSwatch } from './NodeGlyph'
import { LEGEND_ORDER } from './visuals'

/** One verb this record supports, with the record already filled in. */
type Verb = { name: ToolName; plan: FormPlan; seeded: Readonly<Record<string, unknown>> }

/**
 * What the selected node is, and everything it touches.
 *
 * This panel is the reason the graph is not a decoration: every neighbour is a
 * button that moves the selection, and every record that has a page of its own
 * offers a real link to it — the routes come from `src/lib/links.ts`, so the
 * graph is a way into the app rather than a picture beside it.
 */
export function GraphDetail({
  graph,
  node,
  onSelect,
}: {
  graph: Graph
  node: GraphNode | null
  onSelect: (id: string | null) => void
}) {
  const memory = useGraph()
  const { runtime } = useKg()
  const [pending, setPending] = useState<Verb | null>(null)

  /**
   * Everything this record can have done to it, from the registry.
   *
   * `runtime.forNode` answers "which tools touch this type"; the filter below
   * narrows it to the ones that take THIS record as an input, by looking for a
   * field whose schema says `s.id(<this type>)` and filling it in. Without that
   * step "Add application" appears under every application — a tool that touches
   * applications and does nothing to the one you selected.
   *
   * A tool that survives that and still cannot be given a form is dropped by
   * `planToolForm`, which is the same reader the palette uses, so a verb offered
   * here is a verb that opens.
   */
  const verbs: Verb[] = useMemo(() => {
    if (!node) return []
    const stored = memory.node(node.recordId)
    // Roles and sources are synthesised for this canvas and never written down
    // (D5), so their `recordId` names no record and there is nothing to do to
    // one. The panel already says as much underneath.
    if (!stored) return []

    const countOf = (type: NodeType) => memory.ofType(type).length
    const rows: Verb[] = []

    for (const tool of runtime.forNode(stored.id)) {
      const seeded: Record<string, unknown> = {}
      for (const [key, meta] of Object.entries(tool.input.meta.fields ?? {})) {
        if (meta.kind === 'id' && meta.nodeType === stored.type) seeded[key] = stored.id
      }
      if (Object.keys(seeded).length === 0) continue

      // Asked again WITH the record. `forNode` can only call `available` with
      // no input, and `application.offer.decide` answers "yes" to that because
      // it has no id to look at — so it was offered on every application and
      // refused on the ones with no offer, at the point the user pressed it.
      const fit = tool.available?.(memory, seeded)
      if (fit && !fit.ok) continue

      const plan = planToolForm(tool, { countOf, seeded })
      if (!plan) continue
      // `tools/index.ts:181-185` throws at module load unless every tool answers
      // to the key it is filed under, so a tool that came out of the registry
      // has a name that is one of its keys.
      rows.push({ name: tool.name as ToolName, plan, seeded })
    }
    return rows
  }, [memory, runtime, node])

  const groups = useMemo(() => {
    if (!node) return []
    const byType = new Map<string, { node: GraphNode; rel: GraphRel }[]>()
    for (const edge of incidentEdges(graph, node.id)) {
      const other = graph.byId.get(otherEnd(edge, node.id))
      if (!other) continue
      const list = byType.get(other.type)
      if (list) list.push({ node: other, rel: edge.rel })
      else byType.set(other.type, [{ node: other, rel: edge.rel }])
    }
    // Legend order, so the panel and the key beneath the canvas agree.
    return LEGEND_ORDER.filter((type) => byType.has(type)).map((type) => ({
      type,
      items: byType.get(type) ?? [],
    }))
  }, [graph, node])

  if (!node) {
    return (
      <Panel className="min-w-0">
        <PanelTitle>Selected record</PanelTitle>
        <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
          <div className="grid size-9 place-items-center rounded-lg border border-hairline bg-well text-text-3">
            <MousePointerClick className="size-4" strokeWidth={1.7} aria-hidden />
          </div>
          <p className="text-sm text-text-2">Nothing selected</p>
          <p className="max-w-xs text-xs text-text-3">
            Pick a node — by clicking it, or by tabbing to it and pressing Enter — to see what it
            connects to and where it lives in the app.
          </p>
        </div>
      </Panel>
    )
  }

  return (
    <>
      <Panel className="min-w-0">
        <PanelTitle>Selected record</PanelTitle>

        <div className="flex items-center gap-2 text-xs text-text-3">
          <TypeSwatch type={node.type} />
          {NODE_TYPE_LABEL[node.type]}
          <span aria-hidden>·</span>
          <span className="tabular font-mono">
            {node.degree} {node.degree === 1 ? 'connection' : 'connections'}
          </span>
        </div>

        <p className="mt-1.5 text-sm font-medium break-words text-text-1">{node.label}</p>
        {node.detail ? <p className="mt-0.5 text-xs text-text-2">{node.detail}</p> : null}

        {node.href ? (
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to={node.href}>
              Open {NODE_TYPE_LABEL[node.type].toLowerCase()}
              <ArrowUpRight className="size-3.5" strokeWidth={2} aria-hidden />
            </Link>
          </Button>
        ) : (
          /* Organisations, roles, keywords and sources are derived from the
           records rather than stored as records, so there is no page to open.
           Saying so beats a button that goes somewhere approximate. */
          <p className="mt-3 text-xs text-text-3">
            Derived from your records — it has no page of its own.
          </p>
        )}

        {verbs.length > 0 ? (
          /* The point of the page, made literal: the registry says what a record
           of this kind can have done to it, and every one of those verbs is a
           button here. Nothing on this list is written down twice — add a tool
           and it appears, on every node it touches, with a form of its own. */
          <div className="mt-4">
            <h3 className="text-xs text-text-3">What you can do with it</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {verbs.map((verb) => (
                <Button
                  key={verb.name}
                  type="button"
                  size="sm"
                  variant="outline"
                  title={verb.plan.tool.summary}
                  onClick={() => setPending(verb)}
                >
                  {verb.plan.tool.title}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {groups.length === 0 ? (
          <p className="mt-4 text-xs text-text-3">Nothing points at this record yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {groups.map((group) => (
              <div key={group.type}>
                <h3 className="flex items-center gap-1.5 text-xs text-text-3">
                  <TypeSwatch type={group.type} />
                  {NODE_TYPE_LABEL[group.type]}
                  <span className="tabular font-mono">{group.items.length}</span>
                </h3>
                <ul className="mt-1 space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.node.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(item.node.id)}
                        className="pressable-row flex w-full items-baseline gap-2 rounded-sm px-1 py-1 text-left text-sm text-text-2 transition-colors hover:bg-row-hover hover:text-text-1"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.node.label}</span>
                        <span className="shrink-0 font-mono text-xs text-text-3">
                          {REL_LABEL[item.rel]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {pending ? (
        <ToolRunDialog
          key={pending.name}
          name={pending.name}
          plan={pending.plan}
          seeded={pending.seeded}
          onOpenChange={(next) => {
            if (!next) setPending(null)
          }}
        />
      ) : null}
    </>
  )
}
