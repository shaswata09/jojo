import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Quote } from 'lucide-react'
import type { AgentStep } from '@jojo/service/agent/loop'
import type { AgentEntry } from '@jojo/service/react/use-agent'
import { useVault } from '@jojo/service/react/use-vault'
import { StepRow, Thinking } from '@/components/assistant/AgentTrace'
import { Mark } from '@/components/assistant/Mark'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import { Button } from '@/components/ui/button'
import { vaultPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { cn } from '@/lib/utils'

/** How long "Copied" stays on a reply's button. */
export const COPIED_MS = 1600

/**
 * One conversation's turns: the person's questions, each tool the agent ran,
 * its narration while it works, and its answers — in the order they happened.
 *
 * Shared by the Assistant page and the floating chat dock's windows, which
 * show the same conversation and must not draw it differently. The scroller
 * and the empty state belong to the surface; this is the list inside them,
 * with the three things a reply can do — copy it, keep it as a snippet, and
 * undo one of the agent's steps — because those behave the same everywhere.
 *
 * The trace is rendered straight through: nothing here re-sorts or groups
 * `useAgent`'s flat entry list, because an interleaving computed at render time
 * is one that can be computed wrongly.
 */
export function Transcript({
  entries,
  busy,
  model,
  query = '',
  compact = false,
}: {
  entries: readonly AgentEntry[]
  busy: boolean
  /** The model's name, for the "working" line. */
  model: string
  /** Words to mark, when a search led here. */
  query?: string
  /** Tighter type for a dock window. */
  compact?: boolean
}) {
  const { addSnippet } = useVault()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const copy = async (id: string, text: string) => {
    clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(text)
      setCopyFailed(false)
    } catch {
      setCopyFailed(true)
    }
    setCopiedId(id)
    copyTimer.current = setTimeout(() => setCopiedId(null), COPIED_MS)
  }

  /**
   * Undoing one step of the agent's work.
   *
   * Goes through the same `undo` the toast on a button press would have called,
   * because it IS that undo — `runtime.run` handed it back and the step kept it.
   * The row stays on screen afterwards: the trace is a record of what happened,
   * and a step vanishing when it is reverted would make the record wrong.
   */
  const undoStep = (step: AgentStep) => {
    step.undo?.()
    toast({ title: 'Undone', description: step.announcement?.title ?? step.title, tone: 'danger' })
  }

  /** The question that produced a given answer, for the snippet's title. */
  const askedBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      const e = entries[i]
      if (e?.kind === 'you') return e.text
    }
    return 'Assistant'
  }

  const saveAnswer = (text: string, asked: string) => {
    const snippet = addSnippet({
      // Titled with the question, because an agent answer has no script behind
      // it to take a title from and "Assistant reply 3" helps nobody find it.
      title: asked.length > 60 ? `${asked.slice(0, 57)}…` : asked,
      tag: 'Email',
      body: text,
    })
    toast({
      title: 'Saved to snippets',
      description: `${snippet.title} · filed under ${snippet.tag}`,
      action: { label: 'Open vault', onClick: () => navigate(vaultPath({ tool: 'snippets' })) },
    })
  }

  const text = compact ? 'text-[13px]' : 'text-sm'

  return (
    <>
      {/* `aria-busy` while the run is going, and it is not a nicety. The whole
          transcript is one polite live region, and the answer is streamed:
          `agent-runs.ts` rewrites the draft entry once per delta, so a reader
          announced a fresh overlapping half-sentence for every few tokens.
          Busy means "hold, this is mid-update"; clearing it when the run
          settles is what makes the finished answer announce once. */}
      <ul aria-busy={busy} aria-live="polite" className={compact ? 'space-y-2' : 'space-y-3'}>
        {entries.map((entry, index) => {
          if (entry.kind === 'you') {
            return (
              <li key={entry.id} className="flex justify-end">
                <p
                  className={cn(
                    'well rounded-lg px-3 py-2 wrap-anywhere whitespace-pre-line text-text-1',
                    compact ? 'max-w-[85%]' : 'max-w-[36rem]',
                    text,
                  )}
                >
                  <Mark text={entry.text} query={query} />
                </p>
              </li>
            )
          }
          if (entry.kind === 'step') {
            return <StepRow key={entry.id} step={entry.step} onUndo={undoStep} />
          }
          if (entry.kind === 'note') {
            // Narration while it is still working. Quieter than an answer on
            // purpose: it is not the reply, and styling it like one makes a run
            // look finished when it is not.
            return (
              <li key={entry.id} className={cn('px-1 wrap-anywhere text-text-3 italic', text)}>
                <Mark text={entry.text} query={query} />
              </li>
            )
          }
          if (entry.kind === 'error') {
            return (
              <li
                key={entry.id}
                className={cn(
                  'rounded-lg border border-danger-border bg-danger-soft px-3 py-2 wrap-anywhere text-danger',
                  text,
                )}
              >
                {entry.text}
              </li>
            )
          }
          return (
            <li
              key={entry.id}
              className={cn('rounded-lg border border-hairline', compact ? 'p-2.5' : 'p-3')}
            >
              <div className="mb-2 flex items-center gap-2">
                <RobotIcon className="size-4 shrink-0" aria-hidden />
              </div>
              <p className={cn('wrap-anywhere whitespace-pre-line text-text-1', text)}>
                <Mark text={entry.text} query={query} />
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size={compact ? 'xs' : 'sm'}
                  onClick={() => copy(entry.id, entry.text)}
                >
                  <CopyFeedback copied={copiedId === entry.id} failed={copyFailed} />
                </Button>
                <Button
                  variant="ghost"
                  size={compact ? 'xs' : 'sm'}
                  onClick={() => {
                    saveAnswer(entry.text, askedBefore(index))
                  }}
                >
                  <Quote className="size-3.5" strokeWidth={1.8} aria-hidden />
                  Save to snippets
                </Button>
              </div>
            </li>
          )
        })}
        {/* Only while nothing else is moving. A spinner under a step that is
            already spinning says the same thing twice. */}
        {busy && entries.at(-1)?.kind !== 'step' ? <Thinking model={model} /> : null}
      </ul>

      {/* Outside the list: an announcement, not part of the conversation. */}
      <p aria-live="polite" className="sr-only">
        {copiedId ? (copyFailed ? 'Copy was blocked by the browser' : 'Reply copied') : ''}
      </p>
    </>
  )
}
