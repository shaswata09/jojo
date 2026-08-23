import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  SlashIcon,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentStep } from '@jojo/service/agent/loop'
import { readStepDetail } from '@jojo/service/agent/execute'
import { Chip } from '@/components/common/Chip'
import { Button } from '@/components/ui/button'

/**
 * One tool call, as it happens.
 *
 * WHY THIS IS A ROW AND NOT A LOG LINE. What the model did to someone's records
 * is the part of an agent that matters, and it is the part every chat UI hides
 * behind "thinking…". A person who let a 7B loose on their job applications
 * should be able to read back exactly which tools ran, in what order, with what
 * arguments, and undo any of them — without opening a console. So the trace is
 * the primary content of the page, not a debug affordance: the row is always
 * visible, and only the arguments and the raw result are behind a disclosure.
 *
 * Collapsed by default because the useful half is the sentence. `announcement`
 * is what the app's own toast would have said for that write — real prose,
 * already written, and better than any serialiser's rendering of an id.
 */

const STATUS: Record<
  AgentStep['status'],
  { icon: LucideIcon; className: string; label: string; spin?: boolean }
> = {
  running: { icon: Loader2, className: 'text-text-3', label: 'Running', spin: true },
  done: { icon: Check, className: 'text-success', label: 'Done' },
  failed: { icon: X, className: 'text-danger', label: 'Failed' },
  declined: { icon: SlashIcon, className: 'text-warning', label: 'Declined' },
}

/**
 * The effect, named for what it does to the records.
 *
 * A read is `gray` and everything that writes is not, because the only
 * distinction a person scanning this list needs at a glance is "did that change
 * anything". Delete and the two admin tools are red for the obvious reason.
 */
const EFFECT: Record<AgentStep['effect'], { tone: 'gray' | 'teal' | 'amber' | 'red'; label: string }> = {
  read: { tone: 'gray', label: 'read' },
  // A tool that does not exist. Amber rather than grey: it is not a harmless
  // read, it is a call that never had a meaning.
  unknown: { tone: 'amber', label: 'no such tool' },
  create: { tone: 'teal', label: 'added' },
  update: { tone: 'teal', label: 'changed' },
  move: { tone: 'teal', label: 'moved' },
  delete: { tone: 'red', label: 'deleted' },
  admin: { tone: 'red', label: 'store' },
}

export function StepRow({
  step,
  onUndo,
  pending,
}: {
  step: AgentStep
  onUndo?: (step: AgentStep) => void
  /** Set when this step is waiting on a decision. Renders the two buttons. */
  pending?: { allow: () => void; decline: () => void }
}) {
  const [open, setOpen] = useState(false)
  const status = STATUS[step.status]
  const effect = EFFECT[step.effect]
  const Icon = status.icon
  const Disclosure = open ? ChevronDown : ChevronRight

  return (
    <li className="rounded-lg border border-hairline">
      <button
        type="button"
        className="flex w-full items-start gap-2.5 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => {
          setOpen((v) => !v)
        }}
        aria-expanded={open}
      >
        <Disclosure className="mt-0.5 size-3.5 shrink-0 text-text-3" aria-hidden />
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${status.className}${status.spin ? ' animate-spin' : ''}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-1">{step.title}</span>
            <Chip tone={effect.tone} size="sm">
              {effect.label}
            </Chip>
            {/* The registry name, because the title alone does not say WHICH
                tool ran and the two are not one-to-one — five tools are called
                some form of "Update". */}
            <code className="font-mono text-xs text-text-3">{step.name}</code>
          </span>
          {step.announcement ? (
            <span className="mt-0.5 block text-xs text-text-2">
              {step.announcement.title}
              {step.announcement.description ? ` — ${step.announcement.description}` : ''}
            </span>
          ) : step.status === 'failed' || step.status === 'declined' ? (
            <span className="mt-0.5 block text-xs text-danger">{step.detail}</span>
          ) : null}
        </span>
        <span className="sr-only">{status.label}</span>
      </button>

      {/* The approval gate, inline on the step it is about. A modal here would
          ask "delete this?" with the list of what else the agent has done
          hidden behind it, which is the context needed to answer. */}
      {pending ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline bg-warning-soft px-3 py-2">
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-warning">
            The agent asked to do this. Nothing has changed yet.
          </p>
          <Button size="sm" variant="outline" onClick={pending.decline}>
            Don&apos;t
          </Button>
          <Button size="sm" onClick={pending.allow}>
            Allow
          </Button>
        </div>
      ) : null}

      {open ? (
        <div className="space-y-2 border-t border-hairline px-3 py-2">
          <Field label="Arguments" value={JSON.stringify(step.args, null, 2)} />
          <Result step={step} />
        </div>
      ) : null}

      {/* Undo stays available after the run has finished. An agent whose work
          cannot be taken back once it has stopped running is one nobody should
          let write. */}
      {step.status === 'done' && step.undo && onUndo ? (
        <div className="border-t border-hairline px-3 py-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onUndo(step)
            }}
          >
            Undo this step
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/**
 * A step's result, laid out rather than dumped.
 *
 * `detail` is one string carrying two different things — a read comes back as
 * compact JSON and a write comes back as the toast sentence — and rendering
 * both the same way meant a read of forty records was a single 6000-character
 * line in a monospace box. `readStepDetail` tells them apart using the same
 * predicate that chose the format, so it cannot disagree with it.
 *
 * The truncation notice is lifted out of the value and shown as a note. It was
 * appended to the string by `renderOutcome` for the MODEL's benefit; rendered
 * inside the box it reads as part of the data.
 */
function Result({ step }: { step: AgentStep }) {
  const detail = readStepDetail(step)
  if (!detail) return null

  if (detail.kind === 'text') return <Field label="Result" value={detail.value} />

  return (
    <div>
      <p className="text-xs font-medium text-text-3">Result</p>
      <pre className="mt-0.5 max-h-64 overflow-auto rounded-md bg-well p-2 font-mono text-xs whitespace-pre text-text-2">
        {JSON.stringify(detail.value, null, 2)}
      </pre>
      {detail.truncated ? (
        <p className="mt-1 text-xs text-text-3">
          Cut short — the agent was told to narrow the search to see the rest.
        </p>
      ) : null}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-3">{label}</p>
      {/* Its own scroller: a long argument list must not widen the page. */}
      <pre className="mt-0.5 max-h-48 overflow-auto rounded-md bg-well p-2 font-mono text-xs whitespace-pre-wrap text-text-2">
        {value}
      </pre>
    </div>
  )
}

/** Shown while the model is deciding what to do, before any step exists. */
export function Thinking({ model }: { model: string }) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-dashed border-hairline px-3 py-2">
      <Search className="size-4 shrink-0 animate-pulse text-text-3" aria-hidden />
      <span className="text-sm text-text-3">Working — {model} is deciding what to do…</span>
    </li>
  )
}
