import { Link } from 'react-router'
import { Cpu, HardDrive, MonitorSmartphone, ShieldAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
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
    gives: 'Mirrors to a JSON file on disk and keeps submission snapshots',
    active: false,
  },
  {
    icon: Cpu,
    name: '+ Local model',
    requires: 'vLLM, Ollama or LM Studio',
    gives: 'Drafting, CV tailoring and scout scoring',
    active: false,
  },
]

const Kbd = ({ children }: { children: string }) => (
  <span className="rounded-sm border border-hairline bg-well px-1 py-0.5 font-mono text-xs text-text-1">
    {children}
  </span>
)

function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="divide-y divide-hairline">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
          <span className="tabular mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-accent-border bg-accent-soft text-xs font-semibold text-accent">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">{s.title}</p>
            <p className="mt-1 text-sm text-text-2">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function Guide() {
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
                <span className="ml-auto text-xs text-text-3">optional</span>
              )}
            </div>
            <p className="mt-2 text-xs text-text-3">{l.requires}</p>
            <p className="mt-1.5 text-sm text-text-2">{l.gives}</p>
          </li>
        ))}
      </ul>

      <Panel>
        <PanelTitle hint="works the moment you open jojo">Getting started</PanelTitle>
        <Steps
          items={[
            {
              title: 'Fill in your profile',
              body: (
                <>
                  Add your basics, links, research interests and target roles under{' '}
                  <Link to="/profile" className="text-accent underline-offset-4 hover:underline">
                    My profile
                  </Link>
                  , then upload your CV and statements. Everything there drives matching and
                  drafting later, and none of it leaves your device.
                </>
              ),
            },
            {
              title: 'Add your applications',
              body: (
                <>
                  In{' '}
                  <Link
                    to="/applications"
                    className="text-accent underline-offset-4 hover:underline"
                  >
                    Applications
                  </Link>
                  , record each position with its deadline. Switch between the sortable table and
                  the board, and drag a card to move it between stages.
                </>
              ),
            },
            {
              title: 'Let the dashboard nag you',
              body: 'Follow-ups are flagged once their date passes, and deadlines are ordered by urgency. Red means act today; amber means this week.',
            },
            {
              title: 'Save postings before they vanish',
              body: (
                <>
                  Paste any posting URL into{' '}
                  <Link to="/scout" className="text-accent underline-offset-4 hover:underline">
                    Job scout
                  </Link>{' '}
                  and hit Save page. jojo stores a snapshot, so the ad survives after the position
                  closes.
                </>
              ),
            },
          ]}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint="optional">Add the localhost bridge</PanelTitle>
          <Steps
            items={[
              {
                title: 'Run the bridge',
                body: (
                  <>
                    Start the companion server and enter its address and pairing token in{' '}
                    <Link to="/settings" className="text-accent underline-offset-4 hover:underline">
                      Settings
                    </Link>
                    . The token stops other local apps reading your data.
                  </>
                ),
              },
              {
                title: 'One file holds everything',
                body: (
                  <>
                    The bridge mirrors your data to <Kbd>jojo-data.json</Kbd> as you work. Copy that
                    single file to another machine, import it, and your whole search comes with it.
                  </>
                ),
              },
              {
                title: 'Keep submission snapshots',
                body: 'Every submitted application gets a timestamped folder containing exactly the documents you sent — your answer to "which CV version did they get?"',
              },
            ]}
          />
        </Panel>

        <Panel>
          <PanelTitle hint="optional">Add a local model</PanelTitle>
          <Steps
            items={[
              {
                title: 'Connect it',
                body: (
                  <>
                    Run vLLM, Ollama or LM Studio and enter the endpoint in{' '}
                    <Link to="/settings" className="text-accent underline-offset-4 hover:underline">
                      Settings
                    </Link>
                    . Any OpenAI-compatible server works.
                  </>
                ),
              },
              {
                title: 'Use the assistant',
                body: 'It drafts cover letters and follow-ups, tailors your CV to a posting, and preps you for interviews — using your own profile as context, with inference staying local.',
              },
              {
                title: 'Set up scout pipelines',
                body: 'Create a pipeline from a job board URL with a schedule and filters. The model scores each posting against your profile, and good fits land in Matches.',
              },
            ]}
          />
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
              Clearing site data erases everything. Protect yourself two ways: keep the bridge sync
              on, or export a <Kbd>.json</Kbd> backup from Settings regularly. Backups import
              cleanly on any device — that is also how you move between computers.
            </p>
          </div>
        </div>
      </Panel>
    </>
  )
}
