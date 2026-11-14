import { Suspense, lazy, useState } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { StackDiagram } from '@/components/guide/diagrams/StackDiagram'
import { GuideContents } from '@/components/guide/GuideNav'
import { OnThisPage } from '@/components/guide/OnThisPage'
import { CONTROL_FLOWS, FLOW_LAYERS, FLOW_PLACEMENT, FLOW_RULES } from '@/components/guide/flow-map'
import { useTitle } from '@/lib/links'
import { cn } from '@/lib/utils'

/*
 * Both graphs are drawn with @xyflow/react, which is a sizeable chunk, so they
 * load only when this page is opened — the way the benchmark explorer's
 * workflow does.
 */
const CodeFlowGraph = lazy(async () => ({
  default: (await import('@/components/guide/CodeFlowGraph')).CodeFlowGraph,
}))
const ControlFlowGraph = lazy(async () => ({
  default: (await import('@/components/guide/ControlFlowGraph')).ControlFlowGraph,
}))

const Loading = () => (
  <div className="grid h-[38rem] place-items-center rounded-lg border border-hairline bg-well text-xs text-text-3">
    Drawing the graph…
  </div>
)

/**
 * How the code fits together and how control moves through it — for whoever is
 * about to change it, person or model.
 *
 * Two graphs lead. The code flow graph is computed from the source at build
 * time (`scripts/code-graph.mjs`), so it is never out of date. The control flow
 * graphs and everything below them come from `flow-map.ts`, whose test checks
 * the charts are well formed and that every file they name still exists.
 */

const SECTIONS = [
  { id: 'cf-code', label: 'Code flow graph' },
  { id: 'cf-control', label: 'Control flow graphs' },
  { id: 'cf-stack', label: 'The stack' },
  { id: 'cf-layers', label: 'Layer by layer' },
  { id: 'cf-rules', label: 'What keeps it honest' },
  { id: 'cf-where', label: 'Where does it go?' },
] as const

const Path = ({ children }: { children: string }) => (
  <code className="font-mono text-xs wrap-anywhere text-text-1">{children}</code>
)

export function GuideControlFlow() {
  useTitle('Control flow graph')
  const [flowId, setFlowId] = useState(CONTROL_FLOWS[0]?.id ?? '')
  const flow = CONTROL_FLOWS.find((f) => f.id === flowId) ?? CONTROL_FLOWS[0]

  return (
    <>
      <PageHeader
        title="Control flow graph"
        subtitle="Every module of the web app, the phone app, the extension and the shared service, how they depend on each other, and how control moves through the journeys that matter — so a change lands in the right place."
      />

      <OnThisPage sections={SECTIONS} caption="On this page" />

      <Panel id="cf-code" className="scroll-mt-4">
        <PanelTitle hint="computed from the source at build time">Code flow graph</PanelTitle>
        <p className="mb-4 text-sm text-text-2">
          Every module, placed by the layer it belongs to: the web app on the left, the shared
          service down the middle, the phone app on the right. An arrow is an import, from the code
          that uses to the code it uses, and in the service every arrow points down. Pick a module
          to see what it uses, what uses it, and its files; pick a file to follow its imports.
        </p>
        <Suspense fallback={<Loading />}>
          <CodeFlowGraph />
        </Suspense>
      </Panel>

      <Panel id="cf-control" className="scroll-mt-4">
        <PanelTitle hint="every box names the file that does it">Control flow graphs</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          Six journeys, with the branches the code really takes — each decision, refusal and loop.
          Read the one closest to what you are changing first: the step you are about to touch is
          rarely the only one that has to agree.
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Journey">
          {CONTROL_FLOWS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={f.id === flow?.id}
              onClick={() => setFlowId(f.id)}
              className={cn(
                'pressable rounded-full border px-2.5 py-1 text-xs transition-colors',
                f.id === flow?.id
                  ? 'border-accent-border bg-accent-soft text-text-1'
                  : 'border-hairline bg-well text-text-2 hover:text-text-1',
              )}
            >
              {f.name}
            </button>
          ))}
        </div>
        {flow ? (
          <div role="tabpanel" aria-label={flow.name}>
            <p className="mb-3 text-xs text-text-3">{flow.summary}</p>
            <Suspense fallback={<Loading />}>
              <ControlFlowGraph key={flow.id} flow={flow} />
            </Suspense>
            <p className="mt-2 text-xs text-text-3">
              Amber boxes are decisions, red ones stop the journey, green ones end it. Dashed arrows loop
              back. Hover a box for the full path of its file.
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel id="cf-stack" className="scroll-mt-4">
        <PanelTitle hint="model and rules in the service, views in the apps">The stack</PanelTitle>
        <p className="mb-4 text-sm text-text-2">
          The apps are views. The domain — what a record is, what may change it, how it is stored —
          lives once, in <Path>service/</Path>, in six layers that may only depend downward. The
          web app and the phone app each add their own screens and platform wiring on top, and the
          extension does the few things a web page cannot.
        </p>
        <StackDiagram />
      </Panel>

      <Panel id="cf-layers" className="scroll-mt-4">
        <PanelTitle hint={`${String(FLOW_LAYERS.length)} parts, top to bottom`}>Layer by layer</PanelTitle>
        <div className="divide-y divide-hairline">
          {FLOW_LAYERS.map((layer) => (
            <section key={layer.id} aria-labelledby={`cf-layer-${layer.id}`} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h3 id={`cf-layer-${layer.id}`} className="text-sm font-medium text-text-1">
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

      <Panel id="cf-rules" className="scroll-mt-4">
        <PanelTitle hint="each one fails the gate when broken">What keeps it honest</PanelTitle>
        <ul className="divide-y divide-hairline">
          {FLOW_RULES.map((rule) => (
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

      <Panel id="cf-where" className="scroll-mt-4">
        <PanelTitle hint="before you write it">Where does it go?</PanelTitle>
        <dl className="divide-y divide-hairline">
          {FLOW_PLACEMENT.map((item) => (
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
