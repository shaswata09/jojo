import { Check, Loader, RotateCcw, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SceneBackdrop } from '@/components/transfer-ui/SceneBackdrop'
import { summarise, type TransferGroup } from '@/components/transfer-ui/groups'
import type { TransferPhase } from '@/components/transfer-ui/use-transfer-run'
import { cn } from '@/lib/utils'

export type TransferRole = 'send' | 'receive'

type Copy = { title: string; body: string }

/**
 * What the screen says at each point in the run.
 *
 * Kept as data rather than as branches in the markup because the two roles
 * describe the same four states from opposite ends, and a reader checking that
 * "receive" never claims something arrived should be able to read all eight
 * sentences in one place.
 */
const COPY: Record<TransferRole, Record<TransferPhase, Copy>> = {
  send: {
    waiting: {
      title: 'Waiting for the other device',
      body: 'Open jojo on the other device, choose Receive, and give it the code. Nothing is being broadcast while this waits — the code is text on a screen and no more.',
    },
    paired: {
      title: 'The other device answered',
      body: 'Checking the code, then your records start moving.',
    },
    moving: { title: 'Moving your records', body: '' },
    done: {
      title: 'Demonstration finished',
      body: 'Nothing moved. Your records are exactly where they were, on this device — this is what the handoff would look like, not one that happened.',
    },
  },
  receive: {
    waiting: {
      title: 'Waiting for a code',
      body: 'Type the code shown on the other device. This device is not listening to the network and never was.',
    },
    paired: {
      title: 'Ready to receive',
      body: 'The other device is offering the records below. Nothing arrives until you accept.',
    },
    moving: { title: 'Receiving', body: '' },
    done: {
      title: 'Demonstration finished',
      body: 'Nothing arrived. What is on this device is unchanged — this is a walkthrough of the handoff, not one that happened.',
    },
  },
}

export function TransferStage({
  role,
  phase,
  progress,
  groups,
  activeIndex,
  movedCount,
  canStart,
  showScene = true,
  onSimulate,
  onStart,
  onReset,
}: {
  role: TransferRole
  phase: TransferPhase
  /** 0 to 1. Drives the bar and the percentage, which read from one number. */
  progress: number
  groups: readonly TransferGroup[]
  activeIndex: number
  movedCount: number
  canStart: boolean
  /** Lets the page put the WebGPU scene away — see Transfer's page options. */
  showScene?: boolean
  /** Stands in for the second device pointing a camera at this screen. */
  onSimulate: () => void
  onStart: () => void
  onReset: () => void
}) {
  const copy = COPY[role][phase]
  const active = activeIndex >= 0 ? groups[activeIndex] : undefined
  const body =
    phase === 'moving' && active ? `${active.label.toLowerCase()} — ${active.hint}` : copy.body

  return (
    <section className="surface relative flex min-h-[24rem] flex-col overflow-hidden rounded-lg px-4 py-4 sm:px-5 sm:py-5">
      {/* Behind the words, never over them. */}
      {showScene ? <SceneBackdrop /> : null}

      <div className="relative flex flex-1 flex-col">
        <h2 className="text-lg font-medium">{copy.title}</h2>
        <p className="mt-1 max-w-md text-sm text-text-2">{body}</p>

        {phase === 'moving' || phase === 'done' ? (
          <div className="mt-4 max-w-md">
            <div
              role="progressbar"
              aria-label="Transfer progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="h-1.5 w-full overflow-hidden rounded-full bg-well"
            >
              <div
                className="h-full rounded-full bg-info transition-[width] duration-100 ease-linear"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-text-3">
              {phase === 'done'
                ? `${movedCount} of ${groups.length} groups walked through`
                : `${Math.round(progress * 100)}%`}
            </p>
          </div>
        ) : null}

        {groups.length > 0 && phase !== 'waiting' ? (
          <>
            <ul className="mt-4 max-w-xs space-y-1.5">
              {groups.map((group, i) => (
                <li key={group.id} className="flex items-center gap-2 text-sm">
                  <StepIcon
                    state={i < movedCount ? 'moved' : i === activeIndex ? 'moving' : 'idle'}
                  />
                  <span className={cn(i < movedCount ? 'text-text-1' : 'text-text-2')}>
                    {group.label}
                  </span>
                  <span className="tabular ml-auto text-xs text-text-3">{group.count}</span>
                </li>
              ))}
            </ul>
            {phase === 'done' ? (
              <p className="mt-3 max-w-md text-sm text-text-2">
                {summarise(groups)} — that is what would now be on{' '}
                {role === 'send' ? 'the other device' : 'this one'}.
              </p>
            ) : null}
          </>
        ) : null}

        <div className="mt-auto pt-5">
          {phase === 'waiting' && role === 'send' ? (
            <>
              <Button size="sm" disabled={!canStart} onClick={onSimulate}>
                <Smartphone className="size-3.5" strokeWidth={1.8} aria-hidden />
                Stand in for the other device
              </Button>
              <p className="mt-1.5 text-xs text-text-3">
                {canStart
                  ? 'There is no second device. This button plays its part so you can walk the whole journey.'
                  : 'Choose at least one group to send.'}
              </p>
            </>
          ) : null}

          {phase === 'paired' && role === 'receive' ? (
            <Button size="sm" onClick={onStart}>
              Accept and receive
            </Button>
          ) : null}

          {phase === 'done' ? (
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="size-3.5" strokeWidth={1.8} aria-hidden />
              Run it again
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/**
 * Neutral, not green. A tick that has finished is not a status the app is
 * warning anybody about, and colour here is reserved for dates.
 */
function StepIcon({ state }: { state: 'idle' | 'moving' | 'moved' }) {
  if (state === 'moved') {
    return <Check className="size-3.5 text-text-1" strokeWidth={2} aria-hidden />
  }
  if (state === 'moving') {
    return <Loader className="size-3.5 animate-spin text-text-2" strokeWidth={2} aria-hidden />
  }
  // Boxed to the icons' own size so the labels beside it keep one left edge.
  return (
    <span aria-hidden className="grid size-3.5 place-items-center">
      <span className="size-1.5 rounded-full bg-hairline-strong" />
    </span>
  )
}
