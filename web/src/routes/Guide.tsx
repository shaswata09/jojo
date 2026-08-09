import { Link } from 'react-router'
import { Check, Cpu, HardDrive, MonitorSmartphone, ShieldAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Chip } from '@/components/common/Chip'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { TODAY } from '@/data/timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { useLabels } from '@/lib/labels-context'
import { profilePath, scoutPath, settingsPath, useTitle, vaultPath } from '@/lib/links'
import { useScout, useTimeline, useVault, useApplications } from '@/lib/store-context'
import { cn } from '@/lib/utils'

type Layer = {
  icon: LucideIcon
  name: string
  requires: string
  gives: string
  active: boolean
}

const LAYERS: Layer[] = [
  {
    icon: MonitorSmartphone,
    name: 'Browser only',
    requires: 'Nothing to set up',
    gives: 'Track applications, deadlines, follow-ups and documents',
    active: true,
  },
  {
    icon: HardDrive,
    name: '+ Localhost bridge',
    requires: 'A small companion server',
    gives: 'Would mirror to a JSON file on disk and keep submission snapshots',
    active: false,
  },
  {
    icon: Cpu,
    name: '+ Local model',
    requires: 'vLLM, Ollama or LM Studio',
    gives: 'Would score scout matches and draft against your own documents',
    active: false,
  },
]

const Kbd = ({ children }: { children: string }) => (
  <span className="rounded-sm border border-hairline bg-well px-1 py-0.5 font-mono text-xs text-text-1">
    {children}
  </span>
)

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

export function Guide() {
  useTitle('How to use')
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
    <>
      <PageHeader
        title="How to use jojo"
        subtitle="Everything runs on your machine. Start simple, add power when you want it."
      />

      <ul className="grid grid-cols-1 gap-3 sm:gap-3.5 lg:grid-cols-3">
        {LAYERS.map((l) => (
          <li
            key={l.name}
            className={cn('surface rounded-lg p-4', l.active ? 'border-accent-border' : undefined)}
          >
            <div className="flex items-center gap-2">
              <l.icon
                className={cn('size-4', l.active ? 'text-accent' : 'text-text-3')}
                strokeWidth={1.7}
                aria-hidden
              />
              <h2 className="text-sm font-medium">{l.name}</h2>
              {l.active ? (
                <span className="ml-auto text-xs text-accent">active</span>
              ) : (
                // "optional" undersold it: neither of these is present in this
                // build, and the tense of each `gives` line now matches.
                <span className="ml-auto text-xs text-text-3">not connected</span>
              )}
            </div>
            <p className="mt-2 text-xs text-text-3">{l.requires}</p>
            <p className="mt-1.5 text-sm text-text-2">{l.gives}</p>
          </li>
        ))}
      </ul>

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

      <Panel>
        <PanelTitle hint="the profile is not part of the checklist">
          Fill in your profile
        </PanelTitle>
        <p className="text-sm text-text-2">
          Your basics, links, target roles and match terms live under{' '}
          <Link to={profilePath()} className="text-accent underline-offset-4 hover:underline">
            My profile
          </Link>
          . They are what the scout would score against and what the assistant would draft from, so
          they matter — but this build keeps them for the visit only rather than writing them
          anywhere, which is why the checklist above cannot tick for them.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint="not connected">Add the localhost bridge</PanelTitle>
          <ol className="divide-y divide-hairline text-sm">
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">Run the bridge</p>
              <p className="mt-1 text-text-2">
                Start the companion server and enter its address and pairing token in{' '}
                <Link
                  to={settingsPath()}
                  className="text-accent underline-offset-4 hover:underline"
                >
                  Settings
                </Link>
                . The token is what stops other local apps reading your data.
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">One file would hold everything</p>
              <p className="mt-1 text-text-2">
                The bridge mirrors your data to <Kbd>jojo-data.json</Kbd> as you work. Until it is
                running, Settings can still write that same file on demand — Export is real and does
                exactly this.
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">Submission snapshots</p>
              <p className="mt-1 text-text-2">
                Each submitted application would get a timestamped folder holding the documents you
                actually sent. Nothing in this build fetches or copies a file, which is why Job
                scout&rsquo;s snapshot buttons stay greyed out.
              </p>
            </li>
          </ol>
        </Panel>

        <Panel>
          <PanelTitle hint="not connected">Add a local model</PanelTitle>
          <ol className="divide-y divide-hairline text-sm">
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">Connect it</p>
              <p className="mt-1 text-text-2">
                Run vLLM, Ollama or LM Studio and enter the endpoint in{' '}
                <Link
                  to={settingsPath()}
                  className="text-accent underline-offset-4 hover:underline"
                >
                  Settings
                </Link>
                . Any OpenAI-compatible server works.
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">What changes</p>
              <p className="mt-1 text-text-2">
                Drafting stops being a fill-in-the-blanks template and starts reading your profile
                and your documents. The{' '}
                <Link to="/assistant" className="text-accent underline-offset-4 hover:underline">
                  Assistant
                </Link>{' '}
                page shows the worked examples it answers with until then.
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">Scout pipelines start scoring</p>
              <p className="mt-1 text-text-2">
                A pipeline is a saved search you can write today. Scoring is the half that waits on
                the model, and the banner on that page says so rather than showing figures nothing
                produced.
              </p>
            </li>
          </ol>
        </Panel>
      </div>

      <Panel className="border-warning-border">
        <div className="flex gap-3">
          <ShieldAlert
            className="mt-0.5 size-5 shrink-0 text-warning"
            strokeWidth={1.7}
            aria-hidden
          />
          <div>
            <h2 className="text-base font-medium">Your browser is the database</h2>
            <p className="mt-1.5 text-sm text-text-2">
              This build keeps everything in memory for the session, so a reload starts from the
              demo data again — Settings is where you switch between that and an empty store. Export
              a <Kbd>.json</Kbd> backup from there for anything you want to keep.
            </p>
          </div>
        </div>
      </Panel>
    </>
  )
}
