/**
 * The GRAPH half of the evaluation: did it call the right tools, in an order
 * that could work.
 *
 * ## Why this exists beside the turn and state axes
 *
 * The turn axis asks whether each move was defensible. The state axis asks
 * whether the store ended up right. Between them sits the question neither can
 * answer: **did it do the work in an order that makes sense.**
 *
 * A model can pass both while being wrong in a way that only shows on a harder
 * case — writing before reading the id it needs and getting away with it
 * because the world is small, or calling three of four steps and having the
 * store look right because the fourth was a no-op. TaskBench, WorfBench and
 * FlowBench all score this separately for that reason, and report node F1 and
 * edge F1 rather than one number, because the two fail differently: node recall
 * says it missed a step, edge precision says it invented a dependency.
 *
 * ## What is compared
 *
 * The gold `Workflow` against the calls a run actually made, in order. Nodes
 * match on tool NAME — arguments are checked separately, because a model that
 * called the right tool with a wrong argument has made a different mistake from
 * one that called the wrong tool. Edges match on the pair of tool names, so a
 * gold `read -> write` is satisfied by any read of that tool before that write.
 */

import type { CallRecord } from './bench-score'
import type { Workflow } from './bench-conversations'

export type F1 = { readonly precision: number; readonly recall: number; readonly f1: number }

export type WorkflowScore = {
  readonly nodes: F1
  readonly links: F1
  /**
   * How much of the edge axis this graph can actually be judged on.
   *
   * `of` is the gold edge count; `adjudicable` is how many of those connect two
   * tools the graph names exactly ONCE. An edge touching a repeated tool cannot
   * be judged from a call list — three `memory.list` calls do not say which was
   * s2, s4 or s6 — so it contributes to recall and is excluded from precision.
   *
   * Reported rather than folded away, because a precision of 1.000 over zero
   * adjudicable edges is not a score of one, it is an absence of evidence, and
   * the two look identical in a table.
   */
  readonly edges: { readonly of: number; readonly adjudicable: number }
  /** Arguments that could be checked, and how many matched. */
  readonly args: { readonly checked: number; readonly matched: number }
  readonly shape: Workflow['shape']
}

const f1Of = (matched: number, predicted: number, gold: number): F1 => {
  const precision = predicted === 0 ? (gold === 0 ? 1 : 0) : matched / predicted
  const recall = gold === 0 ? 1 : matched / gold
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { precision, recall, f1 }
}

/**
 * Multiset overlap, not set overlap.
 *
 * A workflow that calls `application.update` twice is a different workflow from
 * one that calls it once, and set intersection cannot tell them apart — it
 * would score a model that made one of two required edits as perfect.
 */
function overlap(gold: readonly string[], got: readonly string[]): number {
  const left = new Map<string, number>()
  for (const g of gold) left.set(g, (left.get(g) ?? 0) + 1)
  let matched = 0
  for (const name of got) {
    const n = left.get(name) ?? 0
    if (n > 0) {
      matched += 1
      left.set(name, n - 1)
    }
  }
  return matched
}

/**
 * Every ordering the gold graph implies, as tool-name pairs.
 *
 * The transitive closure and not just the authored links, because a run that
 * does `a`, `b`, `c` for a gold chain `a -> b -> c` has also put `a` before
 * `c`, and that ordering is one the graph asked for even though no link says
 * so. Scoring it as a spurious edge would mark a perfect run down.
 */
function closureOf(links: readonly { from: string; to: string }[]): Set<string> {
  const out = new Set(links.map((l) => `${l.from}->${l.to}`))
  // Floyd–Warshall over tool names. The graphs here are a handful of nodes.
  const names = new Set(links.flatMap((l) => [l.from, l.to]))
  for (const k of names) {
    for (const i of names) {
      if (!out.has(`${i}->${k}`)) continue
      for (const j of names) if (out.has(`${k}->${j}`)) out.add(`${i}->${j}`)
    }
  }
  return out
}

/** The arguments of a call, parsed. `{}` when they were not recorded or not JSON. */
function argsOf(call: CallRecord): Record<string, unknown> {
  if (call.args === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(call.args)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Score one run against the gold graph.
 *
 * `calls` is every call the run made, in order, across every turn — the graph
 * spans the conversation, not a turn, because a dependency routinely crosses
 * one ("tag it with the keyword I made at the start").
 */
/**
 * The shape the links actually draw, which can disagree with the declared one.
 *
 * `shape` is authored by hand and is reported as its own axis — a model that
 * handles ten `single` cases and no `chain` has a nameable weakness that one
 * number hides — so a graph whose declared shape is wrong mislabels a whole
 * column of the report.
 *
 * Here, and exported, because it was written twice: once in the rubric guard
 * and once in the drawing code, and the two definitions disagreed on the first
 * DAG they met. `tag-new-keyword` is two independent calls feeding one write —
 * three nodes, two links, and every source distinct, which the guard's copy
 * read as a chain. A chain needs distinct TARGETS too, and the surviving
 * definition asks the question directly: a chain is a graph one node wide.
 */
export function shapeOf(workflow: Workflow): Workflow['shape'] | 'none' {
  const n = workflow.nodes.length
  if (n === 0) return 'none'
  if (n === 1) return 'single'
  const sources = new Set(workflow.links.map((l) => l.source))
  const targets = new Set(workflow.links.map((l) => l.target))
  const line =
    workflow.links.length === n - 1 &&
    sources.size === workflow.links.length &&
    targets.size === workflow.links.length
  return line ? 'chain' : 'dag'
}

export function scoreWorkflow(gold: Workflow, calls: readonly CallRecord[]): WorkflowScore {
  const made = calls.map((c) => c.name)
  const wanted = gold.nodes.map((n) => n.tool)

  const nodes = f1Of(overlap(wanted, made), made.length, wanted.length)

  /*
   * ## The edge axis, and the two ways the obvious version of it is wrong
   *
   * A run does not declare edges. It declares an ORDER, so both halves of an F1
   * have to be derived, and the naive derivations each break:
   *
   * **Recall** is the easy half. A gold `read -> write` is satisfied by reading
   * at some point before writing — at a distance, not adjacently — because that
   * is the claim the link makes. Requiring adjacency would fail a model for the
   * reasonable act of reading twice.
   *
   * **Precision** was measured against every ordered pair of calls, and that is
   * a bug: n calls make n(n-1)/2 pairs, so a PERFECT three-call run against a
   * two-link chain scored 0.67, and a nine-call run could not clear 0.2. The
   * denominator grew quadratically while the gold set did not.
   *
   * What is actually being asked is narrower: of the orderings the gold graph
   * CONSTRAINS and this run exercised, how many did it get the right way round?
   * So a pair counts only when the two tools are comparable in the gold partial
   * order — one is reachable from the other. A pair of independent calls is
   * excluded rather than counted wrong, because the run had to put them in some
   * order and the graph does not care which. A pair in the wrong direction — a
   * write before the read that grounds it — is the violation this axis exists
   * to catch, and it is the only thing that lowers precision.
   */
  const byId = new Map(gold.nodes.map((n) => [n.id, n.tool]))
  const resolved = gold.links
    .map((l) => {
      const from = byId.get(l.source)
      const to = byId.get(l.target)
      return from === undefined || to === undefined ? null : { from, to }
    })
    .filter((x): x is { from: string; to: string } => x !== null)
  const goldLinks = resolved.map((l) => `${l.from}->${l.to}`)
  const closure = closureOf(resolved)

  const firstAt = new Map<string, number>()
  made.forEach((name, i) => {
    if (!firstAt.has(name)) firstAt.set(name, i)
  })
  const lastAt = new Map<string, number>()
  made.forEach((name, i) => lastAt.set(name, i))

  // Recall: the source happened at all, and happened before the target's last
  // occurrence — a model that reads AFTER writing and then writes again has
  // grounded the write, and one that only reads afterwards has not.
  const satisfied = goldLinks.filter((pair) => {
    const [from, to] = pair.split('->') as [string, string]
    const source = firstAt.get(from)
    const target = lastAt.get(to)
    return source !== undefined && target !== undefined && source < target
  }).length

  /*
   * A tool the gold graph names more than once cannot be adjudicated by name.
   *
   * `long-chain-across-a-summary` calls `memory.list` three times, and one gold
   * edge runs `memory.list -> memory.related` (s4 -> s5). A PERFECT run makes
   * s5's `memory.related` and then s6's `memory.list`, which as a name pair
   * reads as that edge run backwards — so the run was charged a violation for
   * an ordering the graph never stated, and could not score above 0.909
   * however right it was. Measured across the suite: three of 48 gold graphs
   * capped their own perfect run, the worst at 0.667.
   *
   * The information simply is not there. A call list says `memory.list`
   * happened three times; it does not say which occurrence was s2, s4 or s6,
   * and matching them up is a guess. So a pair touching a repeated name is
   * excluded from precision rather than guessed at — recall still carries the
   * whole gold link set, and every unambiguous ordering is still judged.
   */
  const seen = new Map<string, number>()
  for (const node of gold.nodes) seen.set(node.tool, (seen.get(node.tool) ?? 0) + 1)
  const ambiguous = new Set([...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name))

  // Precision: constrained pairs the run exercised, and how many ran the right way.
  let constrained = 0
  let respected = 0
  for (let i = 0; i < made.length; i += 1) {
    if (ambiguous.has(made[i]!)) continue
    for (let j = i + 1; j < made.length; j += 1) {
      if (ambiguous.has(made[j]!)) continue
      const forward = closure.has(`${made[i]!}->${made[j]!}`)
      const backward = closure.has(`${made[j]!}->${made[i]!}`)
      if (!forward && !backward) continue
      constrained += 1
      if (forward) respected += 1
    }
  }

  const links: F1 = {
    /*
     * 1 when nothing could be adjudicated, and that is not generosity.
     * Precision here answers "did the run violate an ordering the graph
     * stated"; with no adjudicable pair the honest answer is "no violation was
     * observed", not "every ordering was wrong". Scoring 0 for a quantity that
     * was never measurable is the confident-zero failure this file has already
     * had once, when an absent `workflow` was averaged in as a failure.
     * Recall is unaffected and still fails a run that skipped the dependency.
     */
    precision: constrained === 0 ? 1 : respected / constrained,
    recall: goldLinks.length === 0 ? 1 : satisfied / goldLinks.length,
    f1: 0,
  }
  const linkF1: F1 = {
    ...links,
    f1:
      links.precision + links.recall === 0
        ? 0
        : (2 * links.precision * links.recall) / (links.precision + links.recall),
  }

  /*
   * Arguments, for the nodes that name any. A `$id` value means "whatever the
   * step it points at returned", which cannot be checked without threading the
   * run's outputs through — so those are counted as checkable only when the
   * argument is a literal.
   */
  let checked = 0
  let matched = 0
  for (const node of gold.nodes) {
    for (const [name, expected] of Object.entries(node.args ?? {})) {
      if (expected.startsWith('$')) continue
      checked += 1
      const hit = calls.some(
        (c) =>
          c.name === node.tool &&
          String(argsOf(c)[name] ?? '')
            .toLowerCase()
            .includes(expected.toLowerCase()),
      )
      if (hit) matched += 1
    }
  }

  const adjudicable = resolved.filter((l) => !ambiguous.has(l.from) && !ambiguous.has(l.to)).length

  return {
    nodes,
    links: linkF1,
    edges: { of: goldLinks.length, adjudicable },
    args: { checked, matched },
    shape: gold.shape,
  }
}
