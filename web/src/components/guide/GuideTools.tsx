import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { ToolGateDiagram } from '@/components/guide/diagrams/ToolGateDiagram'
import { ToolGraphDiagram } from '@/components/guide/diagrams/ToolGraphDiagram'
import { ToolEvalTable } from '@/components/guide/ToolEvalTable'
import { ToolBenchTable } from '@/components/guide/ToolBenchTable'
import { BenchAxesDiagram } from '@/components/guide/diagrams/BenchAxesDiagram'
import { BenchAmbiguityDiagram } from '@/components/guide/diagrams/BenchAmbiguityDiagram'
import { BenchPreviewer } from '@/components/guide/BenchPreviewer'
import {
  CONVERSATIONS as BENCH_CONVERSATIONS,
  GROUPS as BENCH_GROUPS,
} from '@jojo/service/agent/bench-conversations'
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
  /*
   * Derived, not typed as "two".
   *
   * It happens to be two, and it happened to STAY two only because the tool
   * added since this was written is non-undoable without being destructive —
   * so it fell outside the denominator by luck rather than by the sentence
   * being right. A count in prose that survives on a coincidence is a count
   * waiting to be wrong.
   */
  const irreversible = CATALOG.filter((e) => e.destructive && !e.undoable).length

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
          {irreversible === 1 ? 'One' : irreversible === 2 ? 'Two' : String(irreversible)} of those{' '}
          {String(destructive)} cannot be undone at all — the ones that replace or empty the whole
          store. Those are never offered to the assistant unless your own words ask for them, and
          they stop for a confirmation even then.
        </p>
        <p className="mt-3 text-sm text-text-2">
          &ldquo;Your own words ask for them&rdquo; is a specific test, not a judgement call: the
          sentence has to contain something that means erase, something that means the whole store,
          and no mention of a particular kind of record. &ldquo;Clear everything&rdquo; qualifies.
          &ldquo;Clear the tags off the Baylor application&rdquo; does not, and neither does
          &ldquo;delete everything I wrote in that note&rdquo; — both name a thing, so both are
          about that thing.
        </p>
        <p className="mt-3 text-sm text-text-2">
          It errs towards not offering. If you mean it and phrase it unusually, the assistant says
          it cannot rather than guessing, and Settings still has the button.
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

      {/* -------------------------- the workflow --------------------------- */}

      <Panel>
        <PanelTitle hint="steps, not one long try">Work that takes several steps</PanelTitle>
        <p className="text-sm text-text-2">
          Reading a CV is not one question. jojo splits the document on its own headings, asks for
          each section separately, asks once more what was missed, and finally asks how the facts
          relate &mdash; five or six model calls for one upload. Written as a single block of code
          that would be one <code className="font-mono text-xs">try</code> around the lot, and one
          bad reply anywhere in it would lose the whole thing.
        </p>
        <p className="mt-3 text-sm text-text-2">
          So a job like that is declared as <strong>steps with edges between them</strong>. Each
          step says how many times it is worth retrying and whether the job can carry on without
          it; the route from one step to the next is decided by what happened, never by asking the
          model where to go. A step that fails is named in the result rather than disappearing into
          &ldquo;reading your CV failed&rdquo;.
        </p>
        <p className="mt-3 text-sm text-text-2">
          This matters most on a small model. A 7B does not usually fail by reasoning badly over
          many steps &mdash; it fails by returning something malformed on one step out of six. The
          useful answer is to try that step again and leave the other five alone.
        </p>
        <p className="mt-3 text-sm text-text-3">
          A step that only improves the result, like working out how your facts connect, is marked
          optional: if it fails you still get everything the earlier steps found. Loops are allowed
          &mdash; a step may route backwards &mdash; and there is a hard cap on total steps so a
          routing mistake stops with a readable trace instead of spinning against your GPU.
        </p>
      </Panel>

      {/* ------------------ when the model answers badly ------------------- */}
      <Panel>
        <PanelTitle hint="a bad reply costs a pass, not the document">
          When a small model answers badly
        </PanelTitle>
        <p className="text-sm text-text-2">
          A smaller model runs out of room mid-sentence. Reading a CV asks for a list of facts, and
          a reply cut off in the middle of that list has no closing bracket &mdash; so it is not
          JSON, and the obvious thing to do with it is throw it away. jojo keeps everything up to
          the last <strong>finished</strong> entry instead, and says how much was lost. Twenty facts
          arrive instead of none.
        </p>
        <p className="mt-3 text-sm text-text-2">
          It stops at a finished entry on purpose. Half of a job title is worse than no job title:
          it goes in front of you looking complete, and you approve it.
        </p>
        <p className="mt-3 text-sm text-text-2">
          The same care applies to searching. Asked to &ldquo;move my Rice application to
          interview&rdquo; when there are two, a model that searched for one match and got one
          would have no way to know there was a second &mdash; so it would move the wrong record
          confidently. Every search reports how many matched as well as what it is showing, which
          is what lets the assistant come back and ask you which you meant.
        </p>
      </Panel>

      {/* --------------------------- the graph ----------------------------- */}

      <Panel>
        <PanelTitle hint="so a request never stops halfway">How it picks the right one</PanelTitle>
        <p className="text-sm text-text-2">
          Showing a model all {String(CATALOG.length)} tools at once costs well over fifteen
          thousand words of the space it has to think in — before you have typed anything. On a small model
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
        <h3 className="mt-5 text-sm font-medium">A second assistant does the choosing</h3>
        <p className="mt-1.5 text-sm text-text-2">
          Matching your words against a list is fast and free and cannot read intent. &ldquo;I heard
          back from Rice&rdquo; names no tool and no verb, but it plainly means a stage changed. So
          when a model is connected, a second and much smaller job runs first: it reads your request
          — not the conversation, not the results, just what you asked — and answers with the tools
          it thinks are needed.
        </p>
        <p className="mt-3 text-sm text-text-2">
          It is cheap because it does not need the full instructions for each tool, only a name and
          a line: about a sixth of what handing over the whole catalog would cost, and it saves that
          on every step rather than once. Measured over ten questions in a row, it took the first
          message from roughly 8,000 words of context down to 2,900.
        </p>
        <p className="mt-3 text-sm text-text-2">
          It can only narrow. Whatever it picks goes through the same checks as before — the tools
          that make a thing come along with the tools that change it, and the two that empty your
          store are never included unless you asked for them in your own words. If it is slow or
          unavailable, the word-matching runs instead and nothing is lost but a moment.
        </p>

        <h3 className="mt-5 text-sm font-medium">Long conversations</h3>
        <p className="mt-1.5 text-sm text-text-2">
          A model can only hold so much at once, and a conversation that outgrows it gets cut — by
          the server, from the beginning, which is where the rules live. jojo does the cutting
          itself instead, from the oldest end, and never touches its own instructions or your
          current question.
        </p>
        <p className="mt-3 text-sm text-text-2">
          What it removes it first replaces with a short summary of what happened there, so the
          assistant still knows you already told it which Rice application you meant. You are told
          when this happens. Your records are never involved — this is only about what fits in one
          message.
        </p>

        <p className="mt-3 text-sm text-text-2">
          A conversation keeps the tools it has actually used. Ones it was merely offered and never
          touched fall away, so a long chat does not slowly fill up with everything.
        </p>
      </Panel>

      {/* -------------------------- the evidence --------------------------- */}

      <Panel>
        <PanelTitle hint="run against real models, not asserted">Does it actually work?</PanelTitle>
        <p className="text-sm text-text-2">
          Everything above is a design. Whether a given model can actually pick the right tool out
          of jojo&rsquo;s catalog is a question about that model, and the only way to answer it is
          to ask. So there is a suite of scenarios — reading, writing, chains that need a lookup
          first, and cases where the right answer is to do nothing — and it runs against real
          servers.
        </p>
        <p className="mt-3 text-sm text-text-2">
          Each scenario runs twice: once with the whole catalog, and once with the narrowed set.
          That second run is the one that matters. Narrowing is meant to help a smaller model by
          giving it fewer names to confuse — but it could just as easily hurt by removing something
          needed, and a claim like that is worth nothing without the control beside it.
        </p>

        <div className="mt-4">
          <ToolEvalTable />
        </div>

        <h3 className="mt-5 text-sm font-medium">What the suite is looking for</h3>
        <p className="mt-1.5 text-sm text-text-2">
          Not whether a model is clever. Whether it reaches for a document tool when you gave it a
          URL, files a second application instead of updating the one you named, invents an id
          rather than looking one up, or — the case that matters most — hears &ldquo;clear the
          deadline&rdquo; and reaches for the operation that empties your whole store.
        </p>
      </Panel>

      {/* ------------------------ the harder benchmark --------------------- */}

      <Panel>
        <PanelTitle hint="a real store, and what it looked like afterwards">
          Can it hold a conversation?
        </PanelTitle>
        <p className="text-sm text-text-2">
          The suite above asks a model one question and checks whether it named a sensible tool.
          That is the easy half, and it flatters everyone. Real work is not one question: you ask
          what stage something is at, then say &ldquo;move it to interview&rdquo; — and the record
          you mean is in the previous answer, not in the sentence.
        </p>
        <p className="mt-3 text-sm text-text-2">
          So there is a second benchmark. It builds a real store — six applications, a calendar, a
          vault, keywords — hands the assistant a script of {String(BENCH_CONVERSATIONS.length)}{' '}
          conversations across {String(BENCH_GROUPS.length)} kinds of work, and lets the tool calls
          actually run. Then it looks at what is in the store afterwards. Three things are
          scored separately, because a model can pass one and fail another:
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-text-2">
          <li>
            <span className="text-text-1">What it called</span> — was each turn defensible.
          </li>
          <li>
            <span className="text-text-1">How it got there</span> — did it look a record up before
            changing it, or write from the sentence alone.
          </li>
          <li>
            <span className="text-text-1">What it left behind</span> — is the store right, and did
            anything change that should not have.
          </li>
        </ul>

        <div className="mt-4">
          <BenchAxesDiagram />
        </div>

        <div className="mt-5">
          <ToolBenchTable />
        </div>
      </Panel>

      {/* --------------------------- the previewer ------------------------- */}

      <Panel>
        <PanelTitle hint="every case, verbatim">What it was evaluated against</PanelTitle>
        <p className="text-sm text-text-2">
          A score is only worth what its cases are worth, and somebody chose the denominator. So the
          whole benchmark is here to read: the store it ran against, every sentence the assistant
          was sent, and what had to be true of your records afterwards.
        </p>
        <p className="mt-3 text-sm text-text-2">
          This is read from the same list the benchmark runs, not a description of it — so a case
          added tomorrow appears here with its prompts, and one that is quietly dropped disappears.
        </p>

        <div className="mt-4">
          <BenchPreviewer />
        </div>
      </Panel>

      {/* ------------------------- the failure that matters ---------------- */}

      <Panel>
        <PanelTitle hint="the reason the benchmark exists">When two records match</PanelTitle>
        <p className="text-sm text-text-2">
          The store deliberately holds two Rice applications and two UT campuses, because that is
          what a real job search looks like after a few months — and it is the situation where an
          assistant can do real damage while appearing to work perfectly.
        </p>

        <div className="mt-4">
          <BenchAmbiguityDiagram />
        </div>

        <p className="mt-4 text-sm text-text-2">
          This is why jojo is built the way the rest of this page describes. A model cannot be
          relied on to stop, so the things that cannot be undone are never offered unless you ask
          for them by name, every write is checked against what was actually offered, and every
          change lands in your history where you can undo it.
        </p>
        <p className="mt-3 text-sm text-text-2">
          It is also worth saying plainly: one pass of a benchmark ranks models loosely at best.
          Scores moved between runs on the same hardware with the same settings. What does not move
          is the shape of the failure — and that is the part worth designing against.
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
    <Link to={to} className="text-accent underline decoration-1 underline-offset-4 hover:decoration-2">
      {children}
    </Link>
  )
}
