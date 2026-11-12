import { Chip } from '@/components/common/Chip'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { StackDiagram } from '@/components/guide/diagrams/StackDiagram'
import { GuideContents } from '@/components/guide/GuideNav'
import { OnThisPage } from '@/components/guide/OnThisPage'
import {
  FAQ_FLOWS,
  FAQ_LAYERS,
  FAQ_PLACEMENT,
  FAQ_RULES,
  type FaqLayerId,
} from '@/components/guide/faq-map'
import { useTitle } from '@/lib/links'

/**
 * Where the code lives, how a request travels through it, and where a change
 * belongs — for whoever is about to change it, person or model.
 *
 * Everything on the page comes from `faq-map.ts`, whose test checks that every
 * file named here still exists. Nothing is written into this component that
 * the map does not hold, so the page cannot quietly disagree with itself.
 */

const SECTIONS = [
  { id: 'faq-stack', label: 'The stack' },
  { id: 'faq-layers', label: 'Layer by layer' },
  { id: 'faq-flows', label: 'How a request travels' },
  { id: 'faq-rules', label: 'What keeps it honest' },
  { id: 'faq-where', label: 'Where does it go?' },
] as const

/** Short names for the chip beside each flow step. */
const LAYER_CHIP: Record<FaqLayerId, string> = {
  web: 'web',
  mobile: 'phone',
  extension: 'extension',
  bridge: 'bridge',
  react: 'L4 react',
  agent: 'L3.5 agent',
  tools: 'L3 tools',
  repo: 'L2 repo',
  core: 'L1 core',
  storage: 'L0 storage',
  adapters: 'adapter',
}

const Path = ({ children }: { children: string }) => (
  <code className="font-mono text-xs wrap-anywhere text-text-1">{children}</code>
)

export function GuideFaq() {
  useTitle('FAQ')

  return (
    <>
      <PageHeader
        title="FAQ"
        subtitle="How jojo’s code is arranged so one set of rules serves the web app, the phone app and the extension — and where a change belongs before you make it."
      />

      <OnThisPage sections={SECTIONS} caption="On this page" />

      <Panel id="faq-stack" className="scroll-mt-4">
        <PanelTitle hint="model and rules in the service, views in the apps">The stack</PanelTitle>
        <p className="mb-4 text-sm text-text-2">
          The apps are views. The domain — what a record is, what may change it, how it is stored —
          lives once, in <Path>service/</Path>, in six layers that may only depend downward. The
          web app and the phone app each add their own screens and platform wiring on top, and the
          extension does the few things a web page cannot.
        </p>
        <StackDiagram />
      </Panel>

      <Panel id="faq-layers" className="scroll-mt-4">
        <PanelTitle hint={`${String(FAQ_LAYERS.length)} parts, top to bottom`}>Layer by layer</PanelTitle>
        <div className="divide-y divide-hairline">
          {FAQ_LAYERS.map((layer) => (
            <section key={layer.id} aria-labelledby={`faq-layer-${layer.id}`} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 id={`faq-layer-${layer.id}`} className="text-sm font-medium text-text-1">
                  {layer.name}
                </h3>
                <Path>{layer.path}</Path>
              </div>
              <p className="mt-1 text-sm text-text-2">{layer.does}</p>
              <p className="mt-1 text-xs text-text-3">May import: {layer.mayImport}</p>
              <dl className="mt-2.5 grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                {layer.modules.map((m) => (
                  <div key={m.path} className="contents">
                    <dt>
                      <Path>{m.path}</Path>
                    </dt>
                    <dd className="mb-1.5 text-xs text-text-2 sm:mb-0">{m.role}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Panel>

      <Panel id="faq-flows" className="scroll-mt-4">
        <PanelTitle hint="file by file">How a request travels</PanelTitle>
        <p className="mb-4 text-sm text-text-2">
          Six things people do, traced through the files that do them. Read the one closest to what
          you are changing before you change it — the step you are about to touch is rarely the only
          one that has to agree.
        </p>
        <div className="space-y-2">
          {FAQ_FLOWS.map((flow) => (
            <details key={flow.id} className="group rounded-lg border border-hairline bg-well/40 px-3.5 py-2.5">
              <summary className="cursor-pointer text-sm text-text-1 marker:text-text-3">
                {flow.name}
                <span className="ml-2 text-xs text-text-3">{flow.steps.length} steps</span>
              </summary>
              <ol className="mt-3 space-y-2.5">
                {flow.steps.map((step, i) => (
                  <li key={`${step.path}-${String(i)}`} className="flex gap-3">
                    <span className="w-5 shrink-0 text-right font-mono text-xs text-text-3 tabular-nums">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip size="sm">{LAYER_CHIP[step.layer]}</Chip>
                        <Path>{step.path}</Path>
                      </div>
                      <p className="mt-0.5 text-xs text-text-2">{step.does}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      </Panel>

      <Panel id="faq-rules" className="scroll-mt-4">
        <PanelTitle hint="each one fails the gate when broken">What keeps it honest</PanelTitle>
        <ul className="divide-y divide-hairline">
          {FAQ_RULES.map((rule) => (
            <li key={rule.rule} className="py-2.5 first:pt-0 last:pb-0">
              <p className="text-sm text-text-1">{rule.rule}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {rule.enforcedBy.map((path) => (
                  <Path key={path}>{path}</Path>
                ))}
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel id="faq-where" className="scroll-mt-4">
        <PanelTitle hint="before you write it">Where does it go?</PanelTitle>
        <dl className="divide-y divide-hairline">
          {FAQ_PLACEMENT.map((item) => (
            <div key={item.q} className="py-3 first:pt-0 last:pb-0">
              <dt className="text-sm text-text-1">{item.q}</dt>
              <dd className="mt-1 text-sm text-text-2">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <GuideContents />
    </>
  )
}
