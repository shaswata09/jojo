import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowUp, Sparkles } from 'lucide-react'
import { useAgent } from '@jojo/service/react/use-agent'
import type { RunSignal } from '@jojo/service/react/agent-runs'
import type { NodeId } from '@jojo/service/core/model'
import type { GraphQueryResult } from '@jojo/service/agent/graph-query'
import { agentTurn, isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StepRow } from '@/components/assistant/AgentTrace'

/**
 * Ask the graph in a sentence.
 *
 * WHAT THE MODEL PRODUCES IS A QUERY, NOT AN ANSWER. It writes the same
 * structured object the builder below produces — `{kind:'pattern', start:
 * 'application', quantifier:'missing', rel:'ABOUT', end:'timelineItem'}` — which
 * goes through the tool's own schema and then through the engine every other
 * caller uses. There is no string to parse and no expression to evaluate, so the
 * worst a bad generation can do is fail the parse and be told why. The rows on
 * screen were computed by this device from its own records, and the model never
 * sees them unless it asks.
 *
 * That is also why the query it wrote is shown, expanded, next to the answer.
 * "Trust me" is not available to a feature that turns a sentence into a database
 * question; being able to read the question back — and edit it in the builder
 * underneath — is what makes the answer checkable.
 *
 * TWO TOOLS, NOT SIXTY-SEVEN. `graph.query` and `memory.search`, the second
 * because half these questions name a record — "how is Stripe connected to my
 * CV" — and a name has to become something the query can hold. Everything else
 * in the catalog is a bigger prompt and sixty-five chances to do something this
 * card cannot draw.
 */
/** The scratch key this card's run lives under. See the note at `useAgent`. */
const GRAPH_ASK = 'ask:graph' as NodeId

const TOOLS = ['graph.query', 'memory.search'] as const

/** Questions the builder can express but which take a while to click together. */
const SUGGESTIONS = [
  'Which applications have no follow-up scheduled?',
  'Which files are filed under nothing?',
  'Which applications have more than two timeline items?',
]

export function AskBox({
  onAnswer,
  onClear,
}: {
  /** Called with each `graph.query` answer as it lands, and the question asked. */
  onAnswer: (answer: GraphQueryResult, asked: string) => void
  onClear: () => void
}) {
  const { settings } = useModelSettings()
  const connected = isConfigured(settings)
  const [prompt, setPrompt] = useState('')

  /**
   * Built per RUN, so Stop can cancel the request rather than only the loop.
   *
   * `agentTurn` has always taken a signal and no caller ever passed one, so
   * stopping left the socket open until the sixty-second timeout while the UI
   * already said the run had stopped — and the cancelled turn then arrived as a
   * red error blaming the model. The controller lives here because
   * `AbortController` is a platform global the shared layer may not name.
   */
  const llm = useCallback(
    (run: RunSignal) => {
      const controller = new AbortController()
      run.onAbort(() => {
        controller.abort()
      })
      return (messages: Parameters<typeof agentTurn>[1], tools: Parameters<typeof agentTurn>[2]) =>
        agentTurn(settings, messages, tools, controller.signal)
    },
    [settings],
  )

  // Four rounds is generous for two tools: find a name, ask the question,
  // answer. A model still going at four is not converging on this card.
  /*
   * A fixed key rather than a conversation's id. A run is keyed by a string and
   * this card is not a conversation — nothing about it is stored — but it still
   * wants the same thing every run wants: to survive the page it started on.
   * Ask the graph something, wander off, come back and the answer is there.
   */
  const { entries, busy, send, stop, clear } = useAgent({
    llm,
    tools: TOOLS,
    maxSteps: 4,
    thread: { id: GRAPH_ASK, entries: [], history: [] },
  })

  /*
   * The latest `graph.query` answer, lifted out of the trace as it arrives.
   *
   * Read from `entries` rather than tracked separately so there is one source of
   * truth for what happened — the trace is the record, and a second copy of the
   * answer kept beside it is a second thing that can be stale.
   */
  const answered = entries
    .filter((e) => e.kind === 'step' && e.step.name === 'graph.query' && e.step.status === 'done')
    .at(-1)

  const asked = entries.filter((e) => e.kind === 'you').at(-1)

  /*
   * Lift the answer once per step, not once per render.
   *
   * Keyed on the step's id: a step is emitted twice — running, then settled —
   * and the id is stable across both, so this fires on the settle and not again
   * when an unrelated keystroke re-renders the box.
   */
  const answeredId = answered?.kind === 'step' ? answered.step.id : null
  useEffect(() => {
    if (answered?.kind !== 'step' || !answered.step.output) return
    onAnswer(answered.step.output as GraphQueryResult, asked?.kind === 'you' ? asked.text : '')
    // `answered` and `asked` are derived from `entries` and change identity on
    // every render; the id is what actually says "this is a new answer".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredId])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const clean = prompt.trim()
    if (!clean || busy) return
    setPrompt('')
    void send(clean)
  }

  if (!connected) {
    return (
      <div className="rounded-lg border border-dashed border-hairline px-3 py-2.5 text-xs text-text-3">
        <Sparkles className="mr-1.5 inline size-3.5" aria-hidden />
        Connect a local model in{' '}
        <Link to="/settings" className="underline underline-offset-2">
          Settings
        </Link>{' '}
        and you can ask this in a sentence. The builder below works either way.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <form onSubmit={onSubmit} className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="graph-ask" className="sr-only">
            Ask the graph a question
          </Label>
          <Input
            id="graph-ask"
            value={prompt}
            autoComplete="off"
            disabled={busy}
            placeholder="Which applications have no follow-up scheduled?"
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        {busy ? (
          <Button type="button" variant="outline" size="sm" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Ask" disabled={!prompt.trim()}>
            <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
          </Button>
        )}
      </form>

      {entries.length === 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="pressable cursor-pointer rounded-full border border-hairline bg-well px-2.5 py-1 text-xs text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
                onClick={() => {
                  void send(s)
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* The trace, in the card. Every tool it ran, in order — the same
              rows the Assistant shows, because it is the same information and a
              second rendering of it would be a second thing to keep true. */}
          <ul className="space-y-1.5">
            {entries.map((entry) =>
              entry.kind === 'step' ? (
                <StepRow key={entry.id} step={entry.step} />
              ) : entry.kind === 'answer' ? (
                <li key={entry.id} className="px-1 text-sm text-text-1">
                  {entry.text}
                </li>
              ) : entry.kind === 'error' ? (
                <li key={entry.id} className="px-1 text-xs text-danger">
                  {entry.text}
                </li>
              ) : entry.kind === 'note' ? (
                <li key={entry.id} className="px-1 text-xs text-text-3 italic">
                  {entry.text}
                </li>
              ) : null,
            )}
          </ul>
          <button
            type="button"
            className="pressable cursor-pointer rounded-sm border border-hairline bg-well px-2 py-0.5 text-xs text-text-2 transition-colors hover:border-hairline-strong hover:text-text-1"
            onClick={() => {
              clear()
              onClear()
            }}
          >
            Ask something else
          </button>
        </>
      )}
    </div>
  )
}
