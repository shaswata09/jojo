import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { ToolGateDiagram } from '@/components/guide/diagrams/ToolGateDiagram'
import { ToolGraphDiagram } from '@/components/guide/diagrams/ToolGraphDiagram'
import { CATALOG } from '@jojo/service/agent/catalog'
import { assistantPath, guidePath, settingsPath, useTitle } from '@/lib/links'

/**
 * Page 4 — what the assistant can do to your records, and what stops it.
 *
 * The audience here is somebody deciding whether to let a model write to a year
 * of job applications. That is a trust question, not a curiosity one, so the
 * order is: what it can do, what it cannot, how it is stopped, and only then
 * the mechanism that makes the prompt small.
 *
 * The two diagrams answer the two questions that reliably get asked in the
 * wrong order. People ask "how does it pick the right tool" first, and the
 * answer only means anything after they know that picking wrong is caught —
 * so the gate figure comes before the graph figure, even though the code runs
 * them the other way round.
 *
 * The tool COUNT is read from the catalog rather than typed. It was 82 when
 * this was written, it will not stay 82, and a number in prose that quietly
 * stops matching the software is the failure this whole page is arguing the app
 * avoids.
 */
export function GuideTools() {
  useTitle('The tools')

  const reads = CATALOG.filter((e) => e.effect === 'read').length
  const destructive = CATALOG.filter((e) => e.destructive).length
  const writes = CATALOG.length - reads

  return (
    <>
      <PageHeader
        title="The tools"
        subtitle="What the assistant can actually do, what it is stopped from doing, and how it finds the right one."
      />

      {/* --------------------------- what exists --------------------------- */}

      <Panel>
        <PanelTitle hint={`${String(CATALOG.length)} in total`}>What the assistant can do</PanelTitle>
        <p className="text-sm text-text-2">
          The <Go to={assistantPath()}>Assistant</Go> does not type into your screens. It calls the
          same {String(CATALOG.length)} operations the buttons call — the identical code path, with
          the identical checks. There is no second way in, which is why an assistant edit lands in
          your history looking exactly like one you made yourself.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat n={reads} label="ways to look" hint="reading never changes anything" />
          <Stat n={writes} label="ways to change" hint="every one of them undoable…" />
          <Stat n={destructive} label="marked destructive" hint="…except two, which ask first" />
        </div>

        <p className="mt-4 text-sm text-text-2">
          Two of those {String(destructive)} cannot be undone at all — the ones that replace or
          empty the whole store. Those are never offered to the assistant unless your own words ask
          for them, and they stop for a confirmation even then.
        </p>
      </Panel>

      {/* ---------------------------- the gates ---------------------------- */}

      <Panel>
        <PanelTitle hint="the part that actually holds">What stops the wrong one running</PanelTitle>
        <p className="text-sm text-text-2">
          A language model can ask for anything. It can name a tool it was never shown, or invent
          one that does not exist — smaller models do this regularly, and it is not a sign that
          something has gone wrong. So jojo does not rely on the model being careful.
        </p>

        <div className="mt-4">
          <ToolGateDiagram />
        </div>

        <h3 className="mt-5 text-sm font-medium">The distinction that matters</h3>
        <p className="mt-1.5 text-sm text-text-2">
          Choosing what to <em>show</em> the model is a hint. Checking what it actually{' '}
          <em>called</em> is a rule. jojo does both, and only the second one is load-bearing: a call
          to something outside the offered set is refused before anything is looked up, let alone
          run. The model is told the name is unavailable, in the same words it gets for a name that
          does not exist, and it moves on.
        </p>
        <p className="mt-3 text-sm text-text-2">
          This is why the &ldquo;Ask the graph&rdquo; card can safely offer two read-only tools. It
          is not trusting the model to stay within them.
        </p>
      </Panel>

      {/* --------------------------- the graph ----------------------------- */}

      <Panel>
        <PanelTitle hint="so a request never stops halfway">How it picks the right one</PanelTitle>
        <p className="text-sm text-text-2">
          Showing a model all {String(CATALOG.length)} tools at once costs about fifteen thousand
          words of the space it has to think in — before you have typed anything. On a small model
          running on your own machine, that can be more space than it has. So jojo narrows the list
          to what your words point at.
        </p>
        <p className="mt-3 text-sm text-text-2">
          Narrowing carelessly is worse than not narrowing. Most operations need something to act
          on: you cannot attach a keyword without a keyword, or update a document without a
          document. Hide the tool that makes the thing, and the assistant stops halfway with nothing
          on screen explaining why.
        </p>

        <div className="mt-4">
          <ToolGraphDiagram />
        </div>

        <h3 className="mt-5 text-sm font-medium">When it is not sure, it does not narrow</h3>
        <p className="mt-1.5 text-sm text-text-2">
          &ldquo;Remind me about Baylor on Thursday&rdquo; is clear, and jojo offers about a fifth
          of the catalog. &ldquo;Actually, that was the other one&rdquo; is not clear about
          anything — so it offers everything, exactly as it would have before any of this existed.
          Being unsure costs a little speed. Guessing would cost you your answer.
        </p>
        <p className="mt-3 text-sm text-text-2">
          A conversation only ever gains tools. Nothing you have already used is taken away by a
          later question.
        </p>
      </Panel>

      {/* -------------------------- where it runs -------------------------- */}

      <Panel>
        <PanelTitle hint="your choice, and it changes where your words go">
          Which model does this
        </PanelTitle>
        <p className="text-sm text-text-2">
          jojo talks to whatever you point it at in <Go to={settingsPath()}>Settings</Go>. A model
          running on your own machine — Ollama, vLLM, LM Studio — is the default, and it is the only
          arrangement where nothing you write leaves the device.
        </p>
        <p className="mt-3 text-sm text-text-2">
          You can also use Claude, OpenAI and others with an API key. That is a real trade and the
          screen says so plainly: your records go to that company and are billed to your account.
          The key is kept in this browser, is never included in a backup, and is never sent anywhere
          but the provider you chose.
        </p>

        <h3 className="mt-5 text-sm font-medium">If the assistant seems to have stopped reading</h3>
        <p className="mt-1.5 text-sm text-text-2">
          A local model with too little room silently drops the front of what it was sent, and then
          answers confidently about a question it never fully saw. jojo now compares what the server
          says it read against what was actually sent, and tells you when the two disagree — because
          the alternative is an assistant that appears to be bad at its job rather than short of
          room.
        </p>
      </Panel>

      <p className="px-1 pb-2 text-sm text-text-3">
        Next: <Go to={guidePath('built-with')}>what jojo is built with</Go>.
      </p>
    </>
  )
}

/** One number and what it counts, in the three-across shape page 1 uses. */
function Stat({ n, label, hint }: { n: number; label: string; hint: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-well px-3 py-2.5">
      <div className="tabular text-lg font-medium">{n}</div>
      <div className="text-sm text-text-1">{label}</div>
      <div className="mt-0.5 text-xs text-text-3">{hint}</div>
    </div>
  )
}

function Go({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-accent underline-offset-4 hover:underline">
      {children}
    </Link>
  )
}
