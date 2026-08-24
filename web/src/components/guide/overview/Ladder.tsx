import { Cpu, FileText, HardDrive, MonitorSmartphone, Puzzle } from 'lucide-react'
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
    gives: 'Track applications and deadlines, and keep the documents you attach',
    active: true,
  },
  {
    icon: HardDrive,
    name: '+ A backup you keep',
    requires: 'Somewhere to put a file',
    gives: 'One file holding every record and every document, restorable in a click',
    active: true,
  },
  {
    icon: Cpu,
    name: '+ Local model',
    requires: 'Ollama, vLLM or LM Studio — or a free NVIDIA key',
    gives:
      'The agentic half: a threaded assistant that reads and writes your records under your approval, Job Scout pipelines that complete your profile and watch for postings, "Ask the graph" in a sentence, and real scout scoring',
    active: true,
  },
  {
    icon: FileText,
    name: '+ Document reader',
    requires: 'MarkItDown, running locally',
    gives:
      'The model reads your PDFs, Word files and decks — and a job posting, so New → Application from a link fills the form in',
    active: true,
  },
  {
    icon: Puzzle,
    name: '+ The extension',
    requires: 'Chrome, Edge, Brave or Arc',
    gives:
      'Keep a posting exactly as it read. It is also the only part of jojo that is not a page — which is what lets a pipeline sweep a board, and what lets a hosted copy reach a document reader on your own machine',
    active: true,
  },
]

export function LadderSection() {
  return (
    <section id="ladder" className="scroll-mt-4">
      <h2 className="mb-3 text-base font-medium">
        What jojo does with more on the machine
        <small className="ml-2 font-sans text-xs font-normal text-text-3">
          every rung is real; each is optional
        </small>
      </h2>
      {/* The first two rungs are a tracker; the third is where it starts working
          on the search for you. Worth saying once here, because the cards below
          are a list of capabilities and a list does not have a turning point. */}
      <p className="mb-3 text-sm text-text-2">
        The first two rungs are a tracker that never asks you for anything. From the third it
        becomes an assistant that works on the search with you — and every rung above that is still
        yours to skip.
      </p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3">
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
              {/* `active` means "this rung is built", not "you have it set up".
                  It read "not connected" on the model rung while the assistant
                  was already agentic against a real endpoint — a page telling
                  the reader a feature does not exist while they are using it.
                  Whether YOU have one configured is answered by the runtime tile
                  in the sidebar, which probes; a static page cannot know. */}
              {l.active ? (
                <span className="ml-auto text-xs text-accent">built</span>
              ) : (
                <span className="ml-auto text-xs text-text-3">not built</span>
              )}
            </div>
            <p className="mt-2 text-xs text-text-3">{l.requires}</p>
            <p className="mt-1.5 text-sm text-text-2">{l.gives}</p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm text-text-2">
        Every page says for itself which rung it is on, rather than making you come back here. The{' '}
        <Go to={assistantPath()}>Assistant</Go> is a threaded agentic chat with a model connected
        and five worked examples without one, badged either way, and{' '}
        <Go to={scoutPath()}>Job scout</Go> scores for real against your profile and says what it
        matched on. <Go to={guidePath('screens')}>Every screen</Go> goes through the rest, page by
        page.
      </p>

      {/* Kept last. This used to be two panels of unbuilt work — a localhost
          bridge and a local model — sitting two thirds of the way up a 370-line
          page, so a first-time reader spent longer on what jojo could not do
          than on what it could. The bridge half is gone: documents are stored
          and backups are real, so the first panel now describes something that
          happens rather than something that would. */}
      <div className="mt-3 grid grid-cols-1 gap-4 sm:mt-3.5 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint="built in">Keep a backup</PanelTitle>
          <ol className="divide-y divide-hairline text-sm">
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">Your documents are stored here</p>
              <p className="mt-1 text-text-2">
                The CVs and cover letters you attach are saved in this browser and survive closing
                the tab. Nothing is uploaded anywhere — and nothing leaves this machine unless you
                download it yourself.
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">One file holds everything</p>
              <p className="mt-1 text-text-2">
                <Go to={settingsPath()}>Settings</Go> writes a backup carrying every record, every
                link between them and every document, all in one file. Restoring it puts all three
                back.
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">Why it matters</p>
              <p className="mt-1 text-text-2">
                A browser may clear its own storage when a disk fills up, and{' '}
                <Kbd>Clear browsing data</Kbd> always will. A backup you have kept is the only copy
                that is not subject to either.
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
                <Go to={settingsPath()}>Settings</Go>. Any OpenAI-compatible server works. No GPU?
                A free key from build.nvidia.com runs the same agent from the same screen — rate
                limited rather than billed, and the only cost is that your records leave the device.
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
