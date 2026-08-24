/**
 * The three sections about working across records rather than inside one: the
 * keyboard, keywords, and asking the store a question.
 *
 * Each is about reaching something you did not navigate to — a palette that
 * finds any record, a tag that cuts across every kind of them, and a query that
 * answers what no list can. The undo story lives with the keyboard because
 * ⌘Z is where a reader meets it.
 */

import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Go } from '@/components/guide/overview/Go'
import { applicationsPath, graphPath, guidePath, profilePath, settingsPath } from '@/lib/links'

/* ----------------------------- keys and undo ------------------------------ */

export function KeysSection() {
  return (
    <Panel id="keys" className="scroll-mt-4">
      <PanelTitle hint="three keys, and two different Undos">
        Doing things without the mouse
      </PanelTitle>

      <dl className="divide-y divide-hairline text-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 py-3 first:pt-0">
          <dt className="shrink-0 basis-28">
            <Kbd>⌘K</Kbd> <span className="text-text-3">/</span> <Kbd>Ctrl K</Kbd>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            <span className="font-medium text-text-1">Find anything, and run it.</span> Type a few
            words and it narrows your applications, reminders and calendar — whole words in any
            order, so &ldquo;rice stat&rdquo; finds the Statistics post at Rice. Underneath the
            records is a <span className="text-text-1">Tools</span> group: the named operations jojo
            is built out of, each with a form generated from what that operation actually takes.
            Picking one does the real thing to your real records, so it toasts, it lands in the
            audit log, and it offers exactly the Undo the same operation offers when you reach it
            from a card. Below that, <span className="text-text-1">Go to</span> reaches every page,
            including the six the sidebar does not list.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 py-3">
          <dt className="shrink-0 basis-28">
            <Kbd>n</Kbd>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            <span className="font-medium text-text-1">Make something.</span> The same six rows as
            the New button: application, reminder, event, draft a message, save a link, save a
            posting. Ignored while a dialog is already open, and ignored while you are typing, so
            the letter n is still a letter.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 py-3 last:pb-0">
          <dt className="shrink-0 basis-28">
            <Kbd>⌘Z</Kbd> <span className="text-text-3">/</span> <Kbd>⇧⌘Z</Kbd>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            <span className="font-medium text-text-1">Undo and redo, anywhere.</span> Not per page —
            the keystroke belongs to the app, and it will undo the stage change you made on another
            screen two minutes ago. Deliberately ignored while the caret is in a text field, so
            inside a half-typed note your browser&rsquo;s own undo wins and a stray ⌘Z cannot
            silently revert some other record behind the dialog.
          </dd>
        </div>
      </dl>

      <h3 className="mt-4 text-sm font-medium">Two Undos, and they do different things</h3>
      <p className="mt-1 text-sm text-text-2">
        <Kbd>⌘Z</Kbd> reverts whatever is on top of the pile at the moment you press it. The{' '}
        <span className="text-text-1">Undo</span> in a toast reverts{' '}
        <span className="text-text-1">that</span> change, even if you have done three things since
        it appeared — which is the point, because a toast lives for seconds and you keep working.
        One user action is one undo however many records it touched: creating an application writes
        the application, its keywords and the deadline the form minted, and undoing it takes all
        three rather than stranding a deadline pointing at nothing.
      </p>
      <p className="mt-2 text-sm text-text-2">
        The pile holds the last fifty changes and starts empty each visit — an undo stack that
        survived a reload would be offering to undo last Tuesday. If you have jojo open in two tabs,
        the one you return to re-reads the database and starts again for the same reason: it cannot
        undo something the other tab did. Everything is still listed in{' '}
        <Go to={settingsPath()}>Settings &rarr; Audit log</Go>, newest first, and the newest row
        there can be undone from it.
      </p>
    </Panel>
  )
}

/* -------------------------------- keywords -------------------------------- */

export function KeywordsSection() {
  return (
    <Panel id="keywords" className="scroll-mt-4">
      <PanelTitle hint="yours, and shared by everything">
        Keywords, and the role tags they are not
      </PanelTitle>
      <p className="text-sm text-text-2">
        Two things in jojo look like tags and behave nothing alike. Getting them the wrong way round
        is the most common way to end up with a filter that will not find what you know is there.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:gap-3.5 lg:grid-cols-2">
        <div className="surface rounded-lg p-4">
          <h3 className="text-sm font-medium">Keywords are yours</h3>
          <p className="mt-1.5 text-sm text-text-2">
            You make them, name them, colour them and put them on anything — an application, a
            reminder, a link, a file, a snippet. They cut across every kind of record, which is what
            makes &ldquo;show me everything to do with the referral&rdquo; a question jojo can
            answer at all.
          </p>
          <p className="mt-2 text-sm text-text-2">
            A keyword is a record in its own right, not a piece of text copied onto rows: rename one
            and every row carrying it follows, and clearing every record leaves your keywords
            standing with their counts at zero.{' '}
            <Go to={settingsPath()}>Settings &rarr; Keywords</Go> renames, recolours and deletes
            them, and tells you how many records each is on before you delete it.
          </p>
        </div>
        <div className="surface rounded-lg p-4">
          <h3 className="text-sm font-medium">Role tags are your list</h3>
          <p className="mt-1.5 text-sm text-text-2">
            A new store starts with five — Assistant Professor, Postdoc, Researcher, ML Engineer,
            Lecturer — and <Go to={profilePath()}>Profile</Go> edits them. They used to be fixed,
            and the argument for that was that the statistics compare across them; what it actually
            meant was that anyone outside academic CS filed their whole search under a label that
            was not true, and the charts then read that label back as if it were. Removing one
            leaves every application carrying it exactly where it is.
          </p>
          <p className="mt-2 text-sm text-text-2">
            Only applications carry one, and the role filter sits in the{' '}
            <Go to={applicationsPath()}>Applications</Go> toolbar next to the only list it filters —
            it used to be pinned in the top bar, which made every number elsewhere ambiguous about
            whether it counted your whole search. Rule of thumb: the role tag is what the job is,
            the keyword is why you care about it.
          </p>
        </div>
      </div>
    </Panel>
  )
}

/* --------------------------------- graph ---------------------------------- */

export function GraphSection() {
  return (
    <Panel id="graph" className="scroll-mt-4">
      <PanelTitle hint="no query language to learn">Ask the graph a question</PanelTitle>
      <p className="text-sm text-text-2">
        Every record in jojo is a node, and every link between two records is a real edge between
        them — that is not a picture of how it works, it is how it is stored. The{' '}
        <Go to={graphPath()}>Graph</Go> page draws it, and its query panel lets you ask the store
        the questions a list cannot answer. It is reached from the sidebar&rsquo;s{' '}
        <span className="text-text-1">Browser storage</span> tile, which is not an obvious door.
      </p>
      <p className="mt-2 text-sm text-text-2">
        A question is three pickers: what you are looking for, whether it{' '}
        <span className="text-text-1">has</span> or is <span className="text-text-1">missing</span>{' '}
        a relationship, and what sits on the other end. The answer updates as you change them —
        there is no Run button, so the table and the controls above it can never disagree.
      </p>
      <h3 className="mt-4 text-sm font-medium">The examples worth clicking first</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-2 marker:text-text-3">
        <li>Applications with no follow-up scheduled — the gap that costs people interviews.</li>
        <li>Everything tagged with one keyword, across every kind of record.</li>
        <li>Organisations you applied to more than once.</li>
        <li>Reminders not linked to any application — work you will do without knowing why.</li>
        <li>Files not used by any application.</li>
      </ul>
      <p className="mt-2 text-sm text-text-2">
        Each is built against the records you actually have, and one your store has nothing to ask
        about is switched off rather than answering with an empty table. The second shape,{' '}
        <span className="text-text-1">Path</span>, answers &ldquo;how are these two connected&rdquo;
        — and answers &ldquo;they are not&rdquo; when they are not, which is a real result rather
        than a failure.
      </p>
      <p className="mt-2 text-sm text-text-2">
        The query line underneath the pickers, the one that looks like code, is labelled{' '}
        <span className="text-text-1">illustrative</span> on the page and means it: nothing parses
        it, and it is there so that seeing the shape beside the words makes the pickers legible.{' '}
        <Go to={guidePath('graph')}>The graph</Go> page of this guide goes through what is drawn and
        why.
      </p>
    </Panel>
  )
}
