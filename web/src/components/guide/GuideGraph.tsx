import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { RecordModelDiagram } from '@/components/guide/diagrams/RecordModelDiagram'
import { UnlinkDiagram } from '@/components/guide/diagrams/UnlinkDiagram'
import { graphPath, guidePath, settingsPath, useTitle } from '@/lib/links'

/**
 * Page 3 — the bridge page, where the audience changes halfway down.
 *
 * The concrete artefact first: the Graph route draws something the reader has
 * already seen, and the model falls out of it. Someone who stops at the halfway
 * point has still learned why deleting an application does not delete its
 * keywords, which is the fact this page exists to deliver.
 *
 * The order is therefore picture, then question, then model, then delete, then
 * the source-reader's paragraph — and NOT the order the code is arranged in.
 * A first draft opened with the eleven node types, on the reasoning that you
 * cannot explain a drawing without explaining what it draws. It read as a
 * schema reference with a screenshot bolted on, and the delete rule — the one
 * thing on this page that changes what a user does — sat below the fold behind
 * two sections about type unions.
 *
 * What this page must not do is restate page 1. That page already covers the
 * three pickers, the worked examples, and that the query line is illustrative;
 * it ends by pointing here for what is drawn and why. So everything below goes
 * a level deeper than that pointer promised: what the marks mean rather than
 * that there are marks, why the illustrative line is shown at all rather than
 * that it is labelled, and the record model underneath both.
 */
export function GuideGraph() {
  useTitle('The graph underneath')

  return (
    <>
      <PageHeader
        title="The graph underneath"
        subtitle="Every record is a node and every link between them is an edge. The Graph page draws exactly that."
      />

      {/* ------------------------- the drawn artefact ---------------------- */}

      <Panel>
        <PanelTitle hint="not an illustration of the store — the store">
          What the picture is showing
        </PanelTitle>
        <p className="text-sm text-text-2">
          The <Go to={graphPath()}>Graph</Go> page walks the same records the board and the calendar
          read, on every render, and draws one mark per record and one line per pointer. Nothing on
          that canvas is a second copy of your data and nothing on it is a mock-up: delete an
          application on the board and it is off the canvas before you get back to it.
        </p>

        <h3 className="mt-4 text-sm font-medium">What a mark means</h3>
        <dl className="mt-2 divide-y divide-hairline text-sm">
          <Row term="Colour">
            The kind of record. Nothing on this page is ever red or amber — those two are reserved
            across the whole app for overdue and due-soon, and a red dot here would read as a
            deadline rather than as a type.
          </Row>
          <Row term="Shape">
            The family. Circles are the live records of a search — applications, dated items,
            postings, matches. Rounded squares are what you filed in the Vault: links, files,
            snippets. Diamonds are the things many records share. Two of the four diamonds are
            records with ids of their own, an organisation and a keyword, and the other two are not
            — see below.
          </Row>
          <Row term="Size">
            How many edges touch it, on a square root and capped. A hub with twenty connections is
            legibly bigger than one with four rather than five times the area, which is what sizing
            straight off the count produced: the applications became planets and everything else
            became dust.
          </Row>
          <Row term="A line">
            One pointer between two records, drawn without an arrowhead. Direction is stored, and
            every traversal on this page ignores it — someone asking what connects a file to a job
            does not hold a direction in their head.
          </Row>
        </dl>

        <h3 className="mt-4 text-sm font-medium">Two things the canvas does not do</h3>
        <p className="mt-1 text-sm text-text-2">
          Pressing a row in the legend hides that kind of record, and no node changes size when you
          do. Size is a fact about the record, not about what you are currently looking at, and a
          node that shrank because you hid a legend row would be telling you about your filter
          rather than about your data.
        </p>
        <p className="mt-2 text-sm text-text-2">
          And not everything in your store is on the canvas. Saved searches in Job scout and your
          profile are records, and neither is drawn: a saved search names no record here, and the
          profile is one row that would sit alone in a corner of every picture. They are in the
          export and in the record counts in <Go to={settingsPath()}>Settings</Go> either way.
        </p>
      </Panel>

      {/* ---------------------------- the question ------------------------- */}

      <Panel>
        <PanelTitle hint="three panes, and one of them runs nothing">
          Asking it a question
        </PanelTitle>
        <p className="text-sm text-text-2">
          The panel under the canvas has three parts, and it is worth knowing which is which before
          you trust an answer from it.
        </p>
        <ol className="mt-2 space-y-2 text-sm text-text-2">
          <li>
            <span className="font-medium text-text-1">The pickers are real.</span> What you are
            looking for, whether it <span className="text-text-1">has</span>,{' '}
            <span className="text-text-1">has no</span> or{' '}
            <span className="text-text-1">has at least</span> two of a relationship, what sits on
            the other end, and optionally one keyword everything must carry. Timeline items get a
            second picker nothing else has — a kind, or the reminder flag — because
            &ldquo;applications with no follow-up&rdquo; and &ldquo;reminders not linked to
            anything&rdquo; are the two questions people actually ask and neither is expressible in
            record types alone.
          </li>
          <li>
            <span className="font-medium text-text-1">The query line is not.</span> The block of
            code-looking text under the pickers is generated from them and parsed by nothing. It is
            labelled illustrative on the page itself, and this page will not soften that: there is
            no query language in jojo, typing into that box is not a feature that is coming, and no
            input anywhere accepts one.
          </li>
          <li>
            <span className="font-medium text-text-1">The answer is real.</span> The table lists the
            records that matched and opens them, and the same records light up in the canvas above.
            Long answers are cut to forty rows in the table and say so — every match stays lit in
            the graph regardless.
          </li>
        </ol>

        <h3 className="mt-4 text-sm font-medium">Why the unparsed line is there at all</h3>
        <p className="mt-1 text-sm text-text-2">
          Because it is the shortest way to make the pickers legible. Seeing{' '}
          <span className="font-mono text-xs text-text-1">
            WHERE NOT (a)-[:ABOUT]-(:Timeline item)
          </span>{' '}
          sitting beside the words &ldquo;applications with no follow-up&rdquo; is what turns three
          dropdowns into a sentence you can read, and it teaches the shape of the question rather
          than a syntax you would then have nowhere to type. The rule it has to obey is that it
          never pretends: it carries its own label, it has no run button, and it sits below the
          controls that do the work rather than above them.
        </p>

        <h3 className="mt-4 text-sm font-medium">Three things worth knowing about the answers</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-2 marker:text-text-3">
          <li>
            A question runs against your whole store, never against what is left visible. An answer
            that changed when you pressed a legend row would be worse than no answer.
          </li>
          <li>
            There is no Run button. Every change re-runs immediately, so the table and the controls
            above it can never be describing two different questions.
          </li>
          <li>
            An empty result is phrased in the question&rsquo;s own words. Ask which applications are
            missing a follow-up and get nothing back, and it says every one of them has one — which
            is an answer, not a failure.
          </li>
        </ul>
      </Panel>

      {/* ------------------------------ the model -------------------------- */}

      <Panel>
        <PanelTitle hint="the rule for what earns one">Eleven kinds of record</PanelTitle>
        <p className="mb-4 text-sm text-text-2">
          A value becomes a record of its own when you can rename it or annotate it, and stays a
          field otherwise. An employer passes: you can spell it differently, applications accumulate
          under it, and it is worth being one thing rather than twelve strings. That single test is
          what produced the eleven below and rejected everything else.
        </p>

        <RecordModelDiagram />

        <h3 className="mt-5 text-sm font-medium">One pointer, or many</h3>
        <p className="mt-1 text-sm text-text-2">
          Three of the seven are many-relations: tagging, what a dated thing is{' '}
          <span className="font-mono text-xs text-text-1">ABOUT</span>, and what a vault record is{' '}
          <span className="font-mono text-xs text-text-1">FILED_UNDER</span>. One CV goes to every
          application you send it to and one reference deadline covers every job it covers, so those
          two are lists rather than slots. The other four are at most one per record, and linking
          again replaces what was there in the same write. The identity of a pointer is the triple
          it joins, so creating one twice is the same pointer and there is no way to end up with two
          identical lines between the same two records — which is what makes filing a document under
          a job it is already filed under do nothing at all.
        </p>

        <h3 className="mt-4 text-sm font-medium">
          Two elevens and two sevens, and they are not the same
        </h3>
        <p className="mt-1 text-sm text-text-2">
          The Graph page also has eleven kinds of node and seven kinds of line, which is a
          coincidence worth taking apart because it has misled people who went looking:
        </p>
        <dl className="mt-2 divide-y divide-hairline text-sm">
          <Row term="Nine of eleven overlap">
            Two stored types are never drawn — the saved search and the profile — and two drawn
            types are never stored, which is the next section.
          </Row>
          <Row term="Five of seven overlap">
            Two stored relations are never drawn either. One says an application is a copy of
            another, written when you duplicate one; the other joins a saved posting or a match to
            the search it came from, and it is not drawn because the thing at its far end is not
            drawn. Two drawn relations are never stored.
          </Row>
          <Row term="One name means two things">
            The relationship picker offers <span className="font-mono text-xs">came from</span>, and
            on the canvas it is the line from an application to where you found it — a line the
            store has never held. The stored relation of the same name joins a posting to a saved
            search and appears on no picture at all.
          </Row>
        </dl>
      </Panel>

      {/* ---------------------- drawn but never stored --------------------- */}

      <Panel>
        <PanelTitle hint="role, and source">Two things drawn that were never stored</PanelTitle>
        <p className="text-sm text-text-2">
          An application carries a role tag from a fixed list of five, and optionally where you
          found it from a fixed list of four. Neither is a record. They are closed lists that drive
          one filter and one legend order, they are not things you can rename or annotate, and
          promoting them would put a lookup on every projection in the app in exchange for nothing
          you could then do.
        </p>
        <p className="mt-2 text-sm text-text-2">
          They are drawn anyway, because a picture of which of these came from a referral is worth
          having and a filter chip is not the same picture. The Graph page mints them from the
          properties it already has in hand, at the moment it has them, and writes nothing.
        </p>

        <h3 className="mt-4 text-sm font-medium">How to tell them apart in the picture</h3>
        <p className="mt-1 text-sm text-text-2">
          They are the two diamonds with no employer and no keyword behind them, and the test that
          settles it is that they cannot outlive what they were read from. Delete the last
          application tagged <span className="text-text-1">Postdoc</span> and that node is gone with
          it — there is nowhere else in jojo where the value exists as a thing. Delete the last
          application at an employer and the organisation record stays, because it is a record; the
          same is true of a keyword, which is why clearing every application in{' '}
          <Go to={settingsPath()}>Settings</Go> leaves your keywords behind.
        </p>
        <p className="mt-2 text-sm text-text-2">
          A source node also only appears at all when you have said where something came from. It is
          an optional field, and an application with it unset simply has no line going that way.
        </p>
      </Panel>

      {/* ------------------------------- delete ---------------------------- */}

      <Panel>
        <PanelTitle hint="the one fact worth taking away">
          Deleting unlinks, it never cascades
        </PanelTitle>
        <p className="mb-4 text-sm text-text-2">
          Delete an application and jojo removes that record and the pointers to it, and touches
          nothing at the far end of any of them. A dialog saying &ldquo;delete Rice&rdquo; cannot
          fairly be read as consent to delete the four files someone spent an evening on.
        </p>

        <UnlinkDiagram />

        <h3 className="mt-5 text-sm font-medium">What you will actually see afterwards</h3>
        <p className="mt-1 text-sm text-text-2">
          The file is still in the Vault, filed under nothing. The reminder is still on the
          calendar, about nothing. Your keywords are untouched — they are shared by everything and
          were never owned by that application in the first place. On the Graph page those records
          become unconnected nodes, which is exactly what the{' '}
          <span className="text-text-1">Hide unconnected records</span> switch is for once you have
          cleared out a few dead searches.
        </p>

        <h3 className="mt-4 text-sm font-medium">And no record is ever half-deleted</h3>
        <p className="mt-1 text-sm text-text-2">
          There is no hidden flag marking a record as removed. That approach costs a
          must-never-forget filter on every read, every count, every projection and the export, and
          one place that forgets it is a deleted record rendering back onto your board. Gone means
          the row is not there — and undo puts it back with its pointers, because the write recorded
          what each record looked like before it ran rather than a note about how to reverse itself.
        </p>
      </Panel>

      {/* --------------------- for the source reader ----------------------- */}

      <Panel>
        <PanelTitle hint="for anyone opening the repository">
          One action, one commit, one journal row, one undo
        </PanelTitle>
        <p className="text-sm text-text-2">
          Every write in jojo is a named operation defined outside React, validated against its own
          schema, and run synchronously inside a single transaction. Operations call each other, and
          a nested call joins the transaction it was called from rather than opening its own. That
          is the whole invariant, and the rest of this page falls out of it.
        </p>
        <p className="mt-2 text-sm text-text-2">
          Adding an application is three writes: the record, the employer if this is the first
          application there, and the deadline if you gave one. They land as one commit, so they
          produce one row in the log, one toast, and one press of undo. Deleting one is the same
          shape read backwards — the transaction captured what every record it touched looked like
          before and after, so reversing it relinks the reminder and the file without anyone having
          written a function that knows a reminder and a file were involved. That is why the
          unlinking above has an undo at all, and why the previous approach — a hand-written
          reversal per operation — was where this kind of bug used to live: a person had to remember
          what a write touched, and the write that touched five collections was remembered as
          touching four.
        </p>
        <p className="mt-2 text-sm text-text-2">
          The log is kept. <Go to={settingsPath()}>Settings</Go> lists every write, newest first,
          capped at the most recent two hundred and pruned when the store opens, and offers undo on
          the newest row. The undo <em>stack</em> is a different thing: session-scoped and fifty
          deep, because a stack that survived a reload would invite undoing something from last
          Tuesday, and that needs conflict rules this app does not have.
        </p>
        <p className="mt-2 text-sm text-text-2">
          Where the operations live, which layer may import which, and the same add-an-application
          trace drawn across the five of them is on <Go to={guidePath('built-with')}>Built with</Go>
          .
        </p>
      </Panel>
    </>
  )
}

/**
 * A link into the app or across the section, styled once.
 *
 * The same three classes as page 1's, deliberately duplicated rather than
 * exported from it: the alternative is one guide page importing a private
 * helper from another, which makes the two files a unit and means neither can
 * be rewritten without opening the other.
 */
function Go({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-accent underline decoration-1 underline-offset-4 hover:decoration-2">
      {children}
    </Link>
  )
}

/** One term and its explanation, in the two-column shape page 1 uses. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
      <dt className="basis-44 font-medium">{term}</dt>
      <dd className="min-w-0 flex-1 basis-64 text-text-2">{children}</dd>
    </div>
  )
}
