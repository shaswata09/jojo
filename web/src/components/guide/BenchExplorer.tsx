import { lazy, Suspense, useMemo, useState } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import {
  CONVERSATIONS,
  GROUPS,
  GROUP_BLURB,
  TURN_COUNT,
  type Conversation,
  type Group,
} from '@jojo/service/agent/bench-conversations'
import { DOCUMENTS, WORLD_SHAPE } from '@jojo/service/agent/bench-world'
import { Segment } from '@/components/common/Segment'
import { graphOf, type BenchNode } from '@/components/guide/bench-graph'
import { publishedConversations, runsFor } from '@/components/guide/bench-runs'
/*
 * Split out, for the reason `App.tsx` splits Transfer and Graph: ReactFlow is
 * ~100 kB and it is behind a TAB, on a sub-page of the guide, on a page most
 * sessions never open. Imported statically it lands in the chunk the dashboard
 * waits on. The tab is a real boundary — nothing renders it until someone picks
 * it — so the split costs a fallback and nothing else.
 */
const WorkflowFlow = lazy(async () => ({
  default: (await import('@/components/guide/WorkflowFlow')).WorkflowFlow,
}))
import { cn } from '@/lib/utils'

/**
 * The benchmark, one case at a time: what was asked, what had to happen, and
 * what each model actually did.
 *
 * ## What this replaces, and why
 *
 * A list. Every conversation's turns, one after another, expectations as prose.
 * Readable, and not inspectable — you could not see that a turn forbids twelve
 * tools while requiring one of nine, that two turns share a required tool, or
 * where the checks on the store attach. And it said nothing at all about what
 * the models DID, which is the half a reader came for: the score above says
 * 33/36 and this is the only place that can show which three.
 *
 * ## Read from the suite and the payload, never described
 *
 * The left pane is `CONVERSATIONS`, the array the benchmark runs. The right is
 * `tool-bench.json`, the payload it published. Nothing here is a second
 * description that can fall out of step: a case added tomorrow appears with its
 * prompts and, once the benchmark is re-run, with its results.
 *
 * ## Where the work is
 *
 * In `bench-graph.ts` and `bench-runs.ts`, both pure and both tested against
 * every real conversation — because components are never mounted in this app's
 * tests (D20), so anything that could be wrong must not live in here.
 */

const BY_GROUP = GROUPS.map((group) => ({
  group,
  items: CONVERSATIONS.filter((c) => c.group === group),
})).filter((g) => g.items.length > 0)

const CHECKS = CONVERSATIONS.reduce((n, c) => n + c.finalState.length, 0)
const PUBLISHED = publishedConversations()

type Tab = 'Conversation' | 'Workflow' | 'Expected' | 'Runs' | 'JSON'
const TABS: readonly Tab[] = ['Conversation', 'Workflow', 'Expected', 'Runs', 'JSON']

/* ---------------------------- what is expected ---------------------------- */

const NODE_STYLE: Readonly<Record<BenchNode['kind'], string>> = {
  turn: 'border-accent-border bg-accent text-[color:var(--accent-fg)]',
  allowed: 'border-hairline bg-panel text-text-1',
  forbidden: 'border-danger-border bg-danger-soft text-danger-fg',
  answer: 'border-hairline bg-well text-text-1',
  check: 'border-hairline bg-well text-text-2',
}

const KIND_LABEL: Readonly<Record<BenchNode['kind'], string>> = {
  turn: 'what was said',
  allowed: 'may call',
  forbidden: 'must not call',
  answer: 'the answer must say',
  check: 'true of the store afterwards',
}

/**
 * What each turn is allowed and forbidden to do, a column per turn.
 *
 * Columns rather than a drawn graph, and deliberately: every edge here runs
 * turn-to-turn or turn-to-expectation, both of which the layout already says,
 * so arrows would add ink and no information. The graph with real edges is the
 * Workflow tab, where the arrows carry a dependency a reader cannot infer.
 */
function ExpectedView({ conversation }: { conversation: Conversation }) {
  const graph = useMemo(() => graphOf(conversation), [conversation])
  const columns = useMemo(
    () =>
      Array.from({ length: graph.columns }, (_, i) =>
        graph.nodes.filter((n) => n.column === i).sort((a, b) => a.row - b.row),
      ),
    [graph],
  )

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-3 pb-2">
        {columns.map((column, i) => (
          <div key={i} className="flex w-64 shrink-0 flex-col gap-2">
            <div className="text-xs text-text-3">
              {i < conversation.turns.length ? `Turn ${String(i + 1)}` : 'Afterwards'}
            </div>
            {column.map((node) => (
              <div
                key={node.id}
                title={node.detail}
                className={cn('rounded-md border px-2.5 py-2 text-xs', NODE_STYLE[node.kind])}
              >
                <div className="text-[10px] uppercase tracking-wide opacity-70">
                  {KIND_LABEL[node.kind]}
                </div>
                <div className="mt-0.5 break-words">{node.label}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------- the runs -------------------------------- */

const pct = (n: number): string => `${String(Math.round(n * 100))}%`

function RunsView({ conversation }: { conversation: Conversation }) {
  const runs = runsFor(conversation.id)

  if (runs.length === 0) {
    return (
      <p className="text-sm text-text-3">
        This case is newer than the published run, so no model has been scored against it yet. It
        appears here because the list above is read from the suite itself — the results follow the
        next time the benchmark is run.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <div key={`${run.model}-${run.condition}`} className="rounded-md border border-hairline p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-1">{run.label}</span>
            <span className="text-xs text-text-3">
              {run.condition === 'full' ? 'all tools' : 'narrowed'}
            </span>
            <span
              className={cn(
                'ml-auto inline-flex items-center gap-1 text-xs',
                run.clean ? 'text-text-2' : 'text-warning',
              )}
            >
              {run.clean ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
              {run.clean ? 'clean' : 'failed'}
            </span>
          </div>

          <div className="tabular mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-3">
            <span>{run.calls} calls</span>
            {run.refused > 0 ? <span className="text-warning">{run.refused} refused</span> : null}
            <span>
              {run.turns.filter((t) => t.correct).length}/{run.turns.length} turns
            </span>
            <span>
              {run.state.filter((s) => s.pass).length}/{run.state.length} checks
            </span>
            {/* Said out loud rather than lined up anyway. A case that grew a
                turn since the last publish would otherwise show this model
                failing a turn it was never asked. */}
            {run.stale ? (
              <span className="text-text-3" title="The case has changed since this run was published">
                measured against an earlier version of this case
              </span>
            ) : null}
            {/* The graph axis, which the two above cannot see: a run can pass
                every turn and every check while taking a route that only fails
                on a larger store. */}
            {run.workflow === null ? null : (
              <>
                <span title="F1 against the gold workflow's tool calls">
                  graph {pct(run.workflow.nodeF1)}
                </span>
                <span title="F1 on the orderings the gold graph constrains">
                  order {pct(run.workflow.linkF1)}
                </span>
                {run.workflow.argsChecked > 0 ? (
                  <span title="Arguments the gold workflow names a literal value for">
                    {run.workflow.argsMatched}/{run.workflow.argsChecked} args
                  </span>
                ) : null}
              </>
            )}
          </div>

          {/* Turn numbers are only meaningful against the rubric the run was
              measured on, so a stale run does not get to name them. Its totals
              above are still its own and stay. */}
          {run.stale
            ? null
            : run.turns.map((turn, i) =>
                turn.correct ? null : (
                  <p key={i} className="mt-2 text-xs text-warning">
                    Turn {i + 1}: {turn.failure}
                    {turn.detail ? ` — ${turn.detail}` : ''}
                  </p>
                ),
              )}
          {run.state.map((check, i) =>
            check.pass ? null : (
              <p key={`s${String(i)}`} className="mt-1 text-xs text-warning">
                Store: saw {check.saw ?? '—'}. {check.why}
              </p>
            ),
          )}

          {/* What it actually said. The score cannot show this and it is often
              the whole story — a model that wrote nothing and announced that it
              had is the failure `answerMust` exists for. */}
          {run.answers.some((a) => a !== null && a.length > 0) ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-text-3">What it said</summary>
              {run.answers.map((answer, i) =>
                answer === null || answer === '' ? null : (
                  <p key={i} className="mt-1 text-xs text-text-2">
                    <span className="text-text-3">{i + 1}.</span> {answer}
                  </p>
                ),
              )}
            </details>
          ) : null}

          {run.errors.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-text-3">
                {run.errors.length} refused call{run.errors.length === 1 ? '' : 's'}
              </summary>
              {run.errors.map((e, i) => (
                <p key={i} className="mt-1 break-words text-xs text-text-2">
                  <span className="text-text-1">{e.tool}</span> {e.args}
                  <br />
                  <span className="text-warning">{e.detail}</span>
                </p>
              ))}
            </details>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------- shell --------------------------------- */

export function BenchExplorer() {
  const [selected, setSelected] = useState<Conversation>(CONVERSATIONS[0]!)
  const [tab, setTab] = useState<Tab>('Conversation')
  const [open, setOpen] = useState<Group | null>(CONVERSATIONS[0]!.group)

  return (
    <div>
      <div className="tabular flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-3">
        <span>
          <span className="text-text-1">{CONVERSATIONS.length}</span> conversations
        </span>
        <span>
          <span className="text-text-1">{TURN_COUNT}</span> turns
        </span>
        <span>
          <span className="text-text-1">{CHECKS}</span> checks on the store
        </span>
        <span>
          <span className="text-text-1">{Object.values<number>(WORLD_SHAPE).reduce((a, b) => a + b, 0)}</span>{' '}
          records in the world
        </span>
        <span>
          <span className="text-text-1">{Object.keys(DOCUMENTS).length}</span> documents
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        {/* ----------------------------- picker ---------------------------- */}
        <div className="max-h-[28rem] overflow-y-auto rounded-md border border-hairline">
          {BY_GROUP.map(({ group, items }) => (
            <div key={group} className="border-b border-hairline last:border-b-0">
              <button
                type="button"
                onClick={() => setOpen(open === group ? null : group)}
                className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-xs hover:bg-row-hover"
                aria-expanded={open === group}
              >
                <ChevronRight
                  className={cn('size-3.5 shrink-0 transition-transform', open === group && 'rotate-90')}
                  aria-hidden
                />
                <span className="text-text-1">{group}</span>
                <span className="tabular ml-auto text-text-3">{items.length}</span>
              </button>
              {open === group ? (
                <>
                  <p className="px-2.5 pb-2 text-xs text-text-3">{GROUP_BLURB[group]}</p>
                  {items.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelected(c)
                        setTab('Conversation')
                      }}
                      className={cn(
                        'block w-full px-2.5 py-1.5 text-left text-xs hover:bg-row-hover',
                        c.id === selected.id ? 'bg-well text-text-1' : 'text-text-2',
                      )}
                    >
                      {c.id}
                      {PUBLISHED.has(c.id) ? null : (
                        <span className="ml-1.5 text-text-3">· not yet run</span>
                      )}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ))}
        </div>

        {/* ----------------------------- detail ---------------------------- */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-1">{selected.id}</span>
            <Segment
              className="ml-auto"
              label="What to show about this case"
              options={TABS.map((t) => ({ value: t, label: t }))}
              value={tab}
              onChange={setTab}
            />
          </div>
          <p className="mt-1.5 text-xs text-text-3">{selected.why}</p>

          <div className="mt-3">
            {tab === 'Conversation' ? (
              <div className="space-y-3">
                {selected.turns.map((turn, i) => (
                  <div key={i} className="rounded-md border border-hairline p-3">
                    <div className="flex gap-2">
                      <span className="tabular mt-0.5 text-xs text-text-3">{i + 1}</span>
                      <p className="text-sm text-text-1">{turn.say}</p>
                    </div>
                    <p className="mt-2 text-xs text-text-3">{turn.why}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      {turn.readOnly ? (
                        <span className="rounded border border-hairline bg-well px-1.5 py-0.5 text-text-2">
                          nothing may be written
                        </span>
                      ) : null}
                      {turn.shouldAsk ? (
                        <span className="rounded border border-hairline bg-well px-1.5 py-0.5 text-text-2">
                          it should ask, not act
                        </span>
                      ) : null}
                      {(turn.answerMust ?? []).map((fact) => (
                        <span
                          key={fact}
                          className="rounded border border-hairline bg-well px-1.5 py-0.5 text-text-2"
                        >
                          must say “{fact}”
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                <div>
                  <p className="text-xs text-text-3">True of your records afterwards:</p>
                  <ul className="mt-1.5 space-y-1 text-xs text-text-2">
                    {selected.finalState.map((check, i) => (
                      <li key={i}>{check.why}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {tab === 'Workflow' ? (
              <Suspense
                fallback={
                  <div className="h-[26rem] rounded-lg border border-hairline bg-well" aria-busy>
                    <span className="sr-only">Drawing the workflow</span>
                  </div>
                }
              >
                <WorkflowFlow conversation={selected} />
              </Suspense>
            ) : null}
            {tab === 'Expected' ? <ExpectedView conversation={selected} /> : null}
            {tab === 'Runs' ? <RunsView conversation={selected} /> : null}
            {tab === 'JSON' ? (
              <pre className="max-h-[28rem] overflow-auto rounded-md border border-hairline bg-well p-3 text-xs text-text-2">
                {JSON.stringify(selected, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
