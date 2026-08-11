import { Link } from 'react-router'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Chip } from '@/components/common/Chip'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { useApplications } from '@/kg/react/use-applications'
import { useScout } from '@/kg/react/use-scout'
import { useTimeline } from '@/kg/react/use-timeline'
import { useVault } from '@/kg/react/use-vault'
import { useDialogs } from '@/lib/dialogs-context'
import { useLabels } from '@/lib/labels-context'
import { scoutPath, settingsPath, vaultPath } from '@/lib/links'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

/**
 * One thing to do, and whether it has been done.
 *
 * `done` is read off the store, never remembered separately — a checklist that
 * kept its own ticks would go on claiming you had added an application after
 * you deleted the last one, which is the failure every frozen count in this app
 * has already been through once.
 *
 * A step with `done: undefined` is one nothing here can observe: a message is
 * drafted into the clipboard and leaves no record, so that row offers the work
 * without pretending to know whether it happened.
 */
type Step = {
  id: string
  title: string
  body: ReactNode
  done?: boolean
  action: { label: string; onClick?: () => void; to?: string }
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="divide-y divide-hairline">
      {steps.map((s, i) => (
        <li key={s.id} className="flex flex-wrap gap-3 py-3 first:pt-0 last:pb-0">
          <span
            aria-hidden
            className={cn(
              'tabular mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
              s.done
                ? 'border-success-border bg-success-soft text-success'
                : 'border-accent-border bg-accent-soft text-accent',
            )}
          >
            {/* Numbered against the trackable steps only, so the last number
                matches the "x of N done" count above. Numbering every row
                against the full list produced a step 7 under a heading that
                said 6 of 6 — which reads as a step the checklist forgot. A
                step nothing here can observe gets a dot instead of a number. */}
            {s.done ? (
              <Check className="size-3.5" strokeWidth={3} />
            ) : s.done === undefined ? (
              <span className="size-1.5 rounded-full bg-current" />
            ) : (
              steps.slice(0, i + 1).filter((step) => step.done !== undefined).length
            )}
          </span>

          <div className="min-w-0 flex-1 basis-64">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {s.title}
              {/* Only two states are ever claimed. "Available" is not a badge —
                  the button beside it already says the step is reachable. */}
              {s.done ? (
                <Chip tone="green" size="sm">
                  Done
                </Chip>
              ) : null}
              <span className="sr-only">{s.done ? ' — done' : ' — not done yet'}</span>
            </p>
            <p className="mt-1 text-sm text-text-2">{s.body}</p>
          </div>

          <div className="shrink-0 self-center">
            {s.action.to ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={s.action.to}>{s.action.label}</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={s.action.onClick}>
                {s.action.label}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

/**
 * The getting-started checklist, and the only part of the old single-page guide
 * that reads the store rather than describing it.
 *
 * Its own component now, and moved out of the route, because the guide became
 * four pages: leaving it inline in a page that four different authors were
 * about to rewrite is how a live checklist quietly becomes a static list of
 * seven bullet points. The counting is the fragile part — "x of N done" counts
 * only the steps something can observe, and the numbers in the gutter count the
 * same set — so it stays here, whole, rather than being reassembled from props.
 *
 * Renders its own Panel. A caller that wrapped it in one would have to know
 * what its heading and hint said, which is the coupling this avoids.
 */
export function GettingStarted() {
  const { open } = useDialogs()
  const { all: applications } = useApplications()
  const { all: items, reminders } = useTimeline()
  const { links, files } = useVault()
  const { postings } = useScout()
  const { labels, countFor } = useLabels()

  const steps: Step[] = [
    {
      id: 'application',
      title: 'Add an application',
      body: 'A position, its stage and its deadline. Everything else in jojo hangs off this record.',
      done: applications.length > 0,
      action: { label: 'New application', onClick: () => open('application') },
    },
    {
      id: 'dated',
      title: 'Give something a date',
      body: 'Deadlines, interviews and campus visits are one kind of record, so they reach the calendar, the week ahead and the application at once.',
      done: items.some((i) => !i.remind),
      action: {
        label: 'New event',
        onClick: () => open('timelineItem', { mode: 'event', initial: { date: TODAY } }),
      },
    },
    {
      id: 'reminder',
      title: 'Set a follow-up',
      body: 'A reminder is the same record with a nudge switched on. Once its date passes it is flagged on the dashboard until you tick it off.',
      done: reminders.length > 0,
      action: {
        label: 'New reminder',
        onClick: () => open('timelineItem', { mode: 'reminder' }),
      },
    },
    {
      id: 'posting',
      title: 'Keep a posting before it is taken down',
      body: 'Nothing is fetched and no copy is stored — what is kept is the URL, the employer guessed from it and the day you saved it. That is enough to find the ad again.',
      done: postings.length > 0 || links.length > 0,
      action: { label: 'Open Job scout', to: scoutPath() },
    },
    {
      id: 'file',
      title: 'File your documents',
      body: 'Drop a CV or a statement into the Vault. Names, sizes and types are recorded; a file you drop in this session also previews.',
      done: files.length > 0,
      action: { label: 'Open the Vault', to: vaultPath({ tool: 'files' }) },
    },
    {
      id: 'keyword',
      title: 'Tag something with a keyword',
      body: 'Keywords are yours, shared by applications, reminders and everything in the Vault — unlike the fixed role tags in the top bar. The tag button on any row adds one.',
      done: labels.some((l) => countFor(l.id) > 0),
      action: { label: 'Manage keywords', to: settingsPath() },
    },
    {
      id: 'draft',
      // Nothing records that a message was written, so this row never ticks —
      // and says why rather than sitting permanently un-done for no reason.
      title: 'Draft a message',
      body: 'Built from your own email snippets, with the role, employer and dates filled in from the record. A person’s name is never filled in for you. Nothing here records that you sent it, so this step does not tick itself.',
      action: { label: 'Draft a message', onClick: () => open('draft') },
    },
  ]

  const trackable = steps.filter((s) => s.done !== undefined)
  const doneCount = trackable.filter((s) => s.done).length

  return (
    <Panel>
      <PanelTitle hint={`${doneCount} of ${trackable.length} done`}>Getting started</PanelTitle>
      {/* Announced, because the ticks change from somewhere else entirely —
          you complete these by working, not by coming back to this page. */}
      <p aria-live="polite" className="mb-3 text-sm text-text-2">
        {doneCount === trackable.length
          ? 'Every step is done. The checklist reads your records, so it follows if you clear them.'
          : 'Each step opens the real thing, and ticks itself once a record exists. Nothing here is a tutorial you have to sit through.'}
      </p>
      <StepList steps={steps} />
    </Panel>
  )
}
