/**
 * The pattern, written the way a graph query language would write it.
 *
 * Illustrative only — jojo parses nothing, and the UI has to say so wherever
 * this is shown. It earns its place by making the shape of the question legible:
 * once you have seen "WHERE NOT (a)-[:ABOUT]-(:Timeline item)" beside the words
 * "applications with no follow-up", the builder above it stops being a mystery.
 *
 * Nothing else in this folder reads what this produces, and nothing should: it
 * is text for a human, generated from the same `GraphQuery` the engine ran.
 */

import { NODE_TYPE_LABEL } from '@/lib/graph/model'
import type { Graph, GraphNodeType } from '@/lib/graph/model'
import type { GraphQuery, ItemFacet } from '@/lib/graph/query'

const variableFor = (type: GraphNodeType | 'any') => (type === 'any' ? 'n' : type[0])

/** '(a:Application)' · '(i:Timeline item {kind: "follow-up"})'. */
function nodePattern(variable: string, type: GraphNodeType | 'any', facet?: ItemFacet) {
  const label = type === 'any' ? '' : `:${NODE_TYPE_LABEL[type]}`
  const props =
    !facet || facet === 'any'
      ? ''
      : facet === 'reminder'
        ? ' {reminder: true}'
        : ` {kind: "${facet}"}`
  return `(${variable}${label}${props})`
}

export function describeQuery(graph: Graph, query: GraphQuery): string {
  if (query.kind === 'path') {
    const from = graph.byId.get(query.from)
    const to = graph.byId.get(query.to)
    if (!from || !to) return 'MATCH p = shortestPath((a)-[*]-(b)) RETURN p'
    return `MATCH p = shortestPath(${nodePattern('a', from.type)}-[*]-${nodePattern('b', to.type)})\nWHERE a.id = "${from.recordId}" AND b.id = "${to.recordId}"\nRETURN p`
  }

  const a = variableFor(query.start)
  const b = query.end === 'any' ? 'm' : variableFor(query.end)
  const start = nodePattern(a, query.start, query.startFacet)
  const end = nodePattern(b === a ? `${b}2` : b, query.end, query.endFacet)
  const rel = query.rel === 'any' ? '-[]-' : `-[:${query.rel}]-`

  const keyword = graph.byId.get(query.keywordId ?? '')
  const keywordClause = keyword
    ? `\nMATCH (${a})-[:TAGS]-(:Keyword {name: "${keyword.label}"})`
    : ''

  if (query.quantifier === 'missing') {
    return `MATCH ${start}${keywordClause}\nWHERE NOT (${a})${rel}${end}\nRETURN ${a}`
  }

  if (query.quantifier === 'atLeast') {
    const n = Math.max(2, query.atLeast ?? 2)
    return `MATCH ${start}${rel}${end}${keywordClause}\nWITH ${a}, count(${b}) AS n\nWHERE n >= ${n}\nRETURN ${a}, n`
  }

  return `MATCH ${start}${rel}${end}${keywordClause}\nRETURN ${a}, ${b}`
}
