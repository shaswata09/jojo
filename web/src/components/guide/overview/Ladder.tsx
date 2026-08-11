import { Cpu, HardDrive, MonitorSmartphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Go } from '@/components/guide/overview/Go'
import { assistantPath, guidePath, scoutPath, settingsPath } from '@/lib/links'
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

export function LadderSection() {
  return (
    <section id="ladder" className="scroll-mt-4">
      <h2 className="mb-3 text-base font-medium">
        What jojo could do with more on the machine
        <small className="ml-2 font-sans text-xs font-normal text-text-3">
          neither is connected in this build
        </small>
      </h2>
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
              <h3 className="text-sm font-medium">{l.name}</h3>
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

      <p className="mt-3 text-sm text-text-2">
        Two pages already say this about themselves where you meet them, rather than making you come
        back here: <Go to={scoutPath()}>Job scout</Go> saves postings and pipelines for real and
        badges its scores as examples, and the <Go to={assistantPath()}>Assistant</Go> answers with
        worked examples and names them as canned rather than improvising a paragraph about whatever
        you typed. <Go to={guidePath('screens')}>Every screen</Go> goes through the rest, page by
        page.
      </p>

      {/* Kept, and kept last. Both of these describe work that is not in this
          build; they used to sit two thirds of the way up a 370-line page,
          which meant a first-time reader spent longer on what jojo cannot do
          than on what it can. */}
      <div className="mt-3 grid grid-cols-1 gap-4 sm:mt-3.5 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint="not connected">Add the localhost bridge</PanelTitle>
          <ol className="divide-y divide-hairline text-sm">
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">Run the bridge</p>
              <p className="mt-1 text-text-2">
                Start the companion server and enter its address and pairing token in{' '}
                <Go to={settingsPath()}>Settings</Go>. The token is what stops other local apps
                reading your data.
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
                <Go to={settingsPath()}>Settings</Go>. Any OpenAI-compatible server works.
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">What changes</p>
              <p className="mt-1 text-text-2">
                Drafting stops being a fill-in-the-blanks template and starts reading your profile
                and your documents. The <Go to={assistantPath()}>Assistant</Go> page shows the
                worked examples it answers with until then.
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
    </section>
  )
}
