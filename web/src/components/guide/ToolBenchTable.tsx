import report from '@/components/guide/tool-bench.json'
import { cn } from '@/lib/utils'

/**
 * What happened when models were given a real store and a real conversation.
 *
 * Generated, not written: `test/bench.test.ts` produces this JSON, so a claim
 * on this page cannot drift away from the run that produced it.
 *
 * ## Why the columns are what they are
 *
 * `Clean` is the headline and is deliberately strict — every turn defensible
 * AND every claim about the store true. It is the only column that answers
 * "did the whole job get done", and it is always the lowest number on the row.
 *
 * `Looked first` earns its place because it is the one column that measures
 * HABIT rather than outcome. A model that reads before it writes will fail
 * safely when it fails; one that writes from a sentence alone is a model that
 * has been lucky so far.
 *
 * `Refused` counts calls jojo's runtime rejected — an invented id, a schema
 * violation, a tool that was not offered. High is not automatically bad: a
 * refusal is the system working. It is a cost, not a wound.
 *
 * `Graph` and `Order` are the axis the other columns cannot see. A run can pass
 * every turn and leave the store correct while taking a route that only works
 * on a store this small — reading nothing and writing from the sentence, or
 * doing two dependent steps in the order that happens not to matter here.
 * `Graph` is F1 against the gold workflow's calls; `Order` is F1 over the
 * orderings that workflow actually constrains, so two independent calls in
 * either order cost nothing and a write before the read that grounds it costs
 * everything.
 *
 * `Order` carries a caveat in its tooltip rather than in silence. An edge
 * between two tools a graph names MORE THAN ONCE cannot be judged from a call
 * list — three `memory.list` calls do not say which was which — so those edges
 * count toward recall and are left out of precision. The tooltip says how many
 * of the gold edges each row could actually judge, because a high `Order` over
 * few judged edges is mostly absence of evidence and looks identical to a high
 * one over many. Neither feeds `Clean`: a model may reach the right answer by a
 * route the rubric did not anticipate, and these say how far it strayed rather
 * than whether it was wrong.
 *
 * ## The conversation breakdown underneath
 *
 * Ordered by how often a conversation failed, not by name, because the reason
 * to publish a benchmark is the failures. A table of scores with nothing under
 * it is a marketing number.
 */

type Score = {
  conversation: string
  group: string
  clean: boolean
  turns: { correct: boolean; failure?: string }[]
  state: { pass: boolean }[]
}

type GroupScore = {
  group: string
  clean: number
  conversations: number
  turnsCorrect: number
  turns: number
  stateChecksPassed: number
  stateChecks: number
}

type Run = {
  model: string
  label: string
  condition: string
  conversationsClean: number
  conversations: number
  turnsCorrect: number
  turns: number
  stateChecksPassed: number
  stateChecks: number
  lookedFirst: number
  refusalRate: number
  grounded: number
  /*
   * Optional, because a report written before the categories existed has none.
   * The page renders without the per-category table rather than failing to
   * build — a guide that cannot compile against last week's results is a guide
   * that blocks a re-run instead of describing one.
   */
  byGroup?: GroupScore[]
  /*
   * The graph axis, also optional, and for a second reason on top of the one
   * above: a payload can carry the field while `conversations` is 0, because
   * the axis only scores the conversations that have an authored gold
   * workflow. Both absences render as "—" rather than as a zero, which would
   * read as a model failing at something nobody measured.
   */
  graph?: {
    conversations: number
    nodeF1: number | null
    nodePrecision: number | null
    nodeRecall: number | null
    linkF1: number | null
    argAccuracy: number | null
    argsChecked: number
    /** Gold edges, and how many of those the axis could actually judge. */
    edges?: number
    edgesAdjudicable?: number
  }
  scores: Score[]
}

/** A rate as a percentage, or an em dash when it was not measured. */
const rate = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : `${String(Math.round(n * 100))}%`

const runs = report.report as Run[]
const models = [...new Set(runs.map((r) => r.model))]

/** How often each conversation failed, across every run. */
const byConversation = (() => {
  const rows = new Map<string, { group: string; failed: number; of: number; how: Set<string> }>()
  for (const run of runs) {
    for (const score of run.scores) {
      const row = rows.get(score.conversation) ?? {
        group: score.group,
        failed: 0,
        of: 0,
        how: new Set<string>(),
      }
      row.of += 1
      if (!score.clean) {
        row.failed += 1
        for (const turn of score.turns) if (turn.failure) row.how.add(turn.failure)
        if (score.state.some((s) => !s.pass)) row.how.add('wrong-final-state')
      }
      rows.set(score.conversation, row)
    }
  }
  return [...rows.entries()].sort((a, b) => b[1].failed - a[1].failed)
})()

/** Every category, summed across all runs, worst first. */
const groupTotals = (() => {
  const rows = new Map<string, { group: string; clean: number; conversations: number }>()
  for (const run of runs) {
    for (const g of run.byGroup ?? []) {
      const row = rows.get(g.group) ?? { group: g.group, clean: 0, conversations: 0 }
      row.clean += g.clean
      row.conversations += g.conversations
      rows.set(g.group, row)
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.clean / a.conversations - b.clean / b.conversations,
  )
})()

const PLAIN: Record<string, string> = {
  'forbidden-call': 'called something the case forbids',
  'no-required-call': 'did not do the thing asked',
  'wrote-on-a-question': 'wrote when it was only asked a question',
  'acted-when-it-should-have-asked': 'guessed instead of asking',
  'said-nothing': 'went silent',
  'answer-missing-fact': 'answered without the fact it was asked for',
  'wrong-final-state': 'left the records wrong',
}

export function ToolBenchTable() {
  const ran = new Date(report.ranAt)
  /*
   * The configuration, said out loud beside the numbers.
   *
   * A score and the setup it was measured under are one fact. These figures
   * were published for a while from a configuration the app does not ship — no
   * declared window, no tool chooser, no summariser — and nothing on this page
   * would have told a reader that, because the page only had the date. The
   * runner records it and `publish.mjs` refuses to build a table whose rows
   * disagree about it, so by the time it reaches here it is a single fact.
   */
  /*
   * Read through a cast because the type comes from the generated JSON itself,
   * so it describes whatever was published last rather than what publish.mjs
   * writes. Absence is handled rather than assumed away: a payload from before
   * the field existed must still render, saying it does not know.
   */
  const setup = (report as { setup?: { harness: boolean; window?: number } }).setup
  const setupSaid =
    setup === undefined
      ? 'in a configuration this payload does not record'
      : setup.harness
        ? `with the harness the app ships — a ${(setup.window ?? 0).toLocaleString()}-token window, tool narrowing and summarising`
        : 'with the harness off, which is not what the app ships'

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-text-3">
              <th className="py-1.5 pr-3 font-medium">Model</th>
              <th className="py-1.5 pr-3 font-medium">Tools</th>
              <th className="py-1.5 pr-3 font-medium">Clean</th>
              <th className="py-1.5 pr-3 font-medium">Turns</th>
              <th className="py-1.5 pr-3 font-medium">State</th>
              <th className="py-1.5 pr-3 font-medium" title="F1 against the gold workflow's tool calls, macro-averaged">
                Graph
              </th>
              <th className="py-1.5 pr-3 font-medium" title="F1 on the orderings the gold graph constrains">
                Order
              </th>
              <th className="py-1.5 pr-3 font-medium">Looked first</th>
              <th className="py-1.5 font-medium">Refused</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) =>
              runs
                .filter((r) => r.model === model)
                .map((r, i) => (
                  <tr
                    key={`${r.model}-${r.condition}`}
                    className={i === 0 ? 'border-t border-hairline' : ''}
                  >
                    <td className="py-1.5 pr-3">{i === 0 ? r.label : null}</td>
                    <td className="py-1.5 pr-3 text-text-2">
                      {r.condition === 'full' ? 'all of them' : 'narrowed'}
                    </td>
                    <td className="tabular py-1.5 pr-3">
                      <span
                        className={
                          r.conversationsClean === r.conversations ? 'text-text-1' : 'text-warning'
                        }
                      >
                        {r.conversationsClean}/{r.conversations}
                      </span>
                    </td>
                    <td className="tabular py-1.5 pr-3 text-text-2">
                      {r.turnsCorrect}/{r.turns}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-text-2">
                      {r.stateChecksPassed}/{r.stateChecks}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-text-2">
                      {rate(r.graph?.nodeF1)}
                    </td>
                    <td
                      className="tabular py-1.5 pr-3 text-text-2"
                      title={
                        r.graph?.edges === undefined
                          ? undefined
                          : `${String(r.graph.edgesAdjudicable ?? 0)} of ${String(r.graph.edges)} gold edges could be judged; the rest join two tools the graph names more than once`
                      }
                    >
                      {rate(r.graph?.linkF1)}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-text-2">
                      {Math.round(r.lookedFirst * 100)}%
                    </td>
                    <td className="tabular py-1.5 text-text-3">
                      {Math.round(r.refusalRate * 100)}%
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>

      {/*
        By category, and this is the table worth reading twice.
        A single score averages "found the record" together with "noticed what
        was missing", and those are different skills that fail for different
        reasons. Averaging them describes neither.
      */}
      <h3 className="mt-5 text-sm font-medium">By kind of work</h3>
      <p className="mt-1 text-xs text-text-3">
        Conversations with nothing wrong in them, summed across all six runs.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-text-3">
              <th className="py-1.5 pr-3 font-medium">Kind of work</th>
              <th className="py-1.5 pr-3 font-medium">Clean</th>
              <th className="py-1.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {groupTotals.map((row) => {
              const rate = row.conversations === 0 ? 0 : row.clean / row.conversations
              return (
                <tr key={row.group} className="border-t border-hairline">
                  <td className="py-1.5 pr-3 text-text-1">{row.group}</td>
                  <td className="tabular py-1.5 pr-3">
                    <span className={rate === 1 ? 'text-text-1' : 'text-warning'}>
                      {row.clean}/{row.conversations}
                    </span>
                  </td>
                  <td className="w-1/2 py-1.5">
                    {/* A bar, because a column of fractions with different
                        denominators is not comparable by eye. */}
                    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-well">
                      <span
                        className={cn('block h-full rounded-full', rate === 1 ? 'bg-text-3' : 'bg-warn')}
                        style={{ width: `${String(Math.round(rate * 100))}%` }}
                      />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h3 className="mt-5 text-sm font-medium">Which conversations went wrong, and how</h3>
      <p className="mt-1 text-xs text-text-3">
        Out of six runs each — three models, with the tool list narrowed and not. Ordered by how
        often the conversation failed, because that is the part worth publishing.
      </p>
      <ul className="mt-2 space-y-1.5">
        {byConversation
          .filter(([, row]) => row.failed > 0)
          .map(([id, row]) => (
            <li key={id} className="text-sm text-text-2">
              <span className="tabular text-text-3">
                {row.failed}/{row.of}
              </span>{' '}
              <span className="text-text-1">{id}</span>
              <span className="text-text-3"> · {row.group}</span> —{' '}
              {[...row.how].map((h) => PLAIN[h] ?? h).join('; ')}
            </li>
          ))}
      </ul>
      {byConversation.every(([, row]) => row.failed === 0) ? (
        <p className="mt-2 text-sm text-text-2">Every conversation was clean on every run.</p>
      ) : null}

      <p className="mt-4 text-xs text-text-3">
        Run on {ran.toLocaleDateString()} against three vLLM servers, one pass each, {setupSaid}.
        Re-running the benchmark is what updates this — the numbers are generated, not typed.
      </p>
    </div>
  )
}
