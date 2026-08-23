import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { ToolTraceDiagram } from '@/components/guide/diagrams/ToolTraceDiagram'

/**
 * How the code is arranged, for someone about to change it.
 *
 * Sits directly under the import-rule figure and picks up where it stops. That
 * figure states the rule; this states the four things a rule cannot: which
 * layer a new file belongs in, why the boundary was worth drawing at all, what
 * one real feature looks like spread across it, and how big each directory
 * actually is. A second drawing of the same five bands was written first and
 * deleted — two diagrams of one stack on one page is not emphasis, it is the
 * reader wondering which of them to believe.
 *
 * Everything numeric here was measured rather than remembered, and the command
 * that measured it is printed next to the table. That is not modesty — a line
 * count in prose is stale within a week and there is no way for a reader to
 * tell, so the honest form is one they can re-run in five seconds.
 */

type LayerFact = { name: string; only: string }

/**
 * What each layer is allowed to do that no other layer is.
 *
 * Written as "the only layer that…" on purpose. Listing what a layer contains
 * duplicates the figure above; listing what makes it different from its
 * neighbours is the part that decides where a new file goes — which is the
 * question somebody opening this repository actually has.
 */
const LAYER_FACTS: LayerFact[] = [
  {
    name: 'kg/core',
    only: 'Imports nothing outside itself — not React, not idb, not even the demo fixtures. The rule is not “no React”, it is “no packages”, which is what lets the record model be tested with no browser anywhere near it.',
  },
  {
    name: 'kg/storage',
    only: 'The only layer allowed to touch a platform API, because that is its job. It never imports kg/core either: it moves opaque rows and a primary key, and the day it learns what an application is, the boundary has already gone.',
  },
  {
    name: 'kg/repo',
    only: 'The only layer allowed to be async. Everything above it is synchronous, which is why clicking a card never waits on a disk.',
  },
  {
    name: 'kg/tools',
    only: 'Every write to the graph, named. It takes the Repository as a type and never a live one, so a tool can run inside a transaction somebody else opened.',
  },
  {
    name: 'kg/react',
    only: 'The only layer that imports React, and the only one allowed to hold a .tsx file. A component anywhere else means a layer has grown an interface.',
  },
]

/**
 * Measured, not remembered.
 *
 * Counts include each directory's own tests, because they are files someone
 * changing that directory will open. `src/components` moves whenever anything
 * ships, which is exactly why the command is printed underneath.
 *
 * The five `web/` rows are also re-measured by `code-structure.test.ts`, so a
 * directory that grows and a table that does not is now a failing build rather
 * than a page quietly telling a reader something that was true in August. That
 * test cannot reach the `service/` rows: `import.meta.glob` is rooted at this
 * app, and `tsconfig.app.json` grants `vite/client` and not `node:fs`, so those
 * six stay hand-maintained and stay the ones to distrust. Exported for the test
 * — the page is the only other reader.
 */
type DirRow = { dir: string; files: number; tests: number; lines: number; what: string }

export const SHAPE: DirRow[] = [
  {
    dir: 'service/kg/core',
    files: 33,
    tests: 15,
    lines: 7700,
    what: 'model, ids, schema, algebra, dates',
  },
  { dir: 'service/kg/repo', files: 15, tests: 7, lines: 5931, what: 'transactions, journal, boot' },
  { dir: 'service/kg/tools', files: 19, tests: 2, lines: 5217, what: '62 named operations' },
  {
    dir: 'service/kg/storage',
    files: 12,
    tests: 3,
    lines: 2496,
    what: 'the port, and no platform',
  },
  { dir: 'service/kg/react', files: 23, tests: 4, lines: 3630, what: 'providers and hooks' },
  { dir: 'service/kg/log.ts', files: 1, tests: 0, lines: 47, what: 'the console is the telemetry' },
  {
    dir: 'web/src/kg/storage',
    files: 11,
    tests: 3,
    lines: 2649,
    what: 'the IndexedDB adapter, and the folder one',
  },
  {
    dir: 'web/src/components',
    files: 240,
    tests: 15,
    lines: 37145,
    what: 'every surface you can see',
  },
  { dir: 'web/src/routes', files: 14, tests: 0, lines: 4103, what: 'thirteen pages' },
  {
    dir: 'web/src/lib',
    files: 78,
    tests: 16,
    lines: 9793,
    what: 'web-only adapters and URL state',
  },
  {
    dir: 'service/data',
    files: 7,
    tests: 1,
    lines: 1369,
    what: 'demo fixtures, below the model',
  },
  {
    dir: 'web/src/data',
    files: 8,
    tests: 0,
    lines: 120,
    what: 'façades over the row above, marked for deletion',
  },
]

/**
 * How many test files this app holds.
 *
 * Named and exported for the same reason as `SHAPE`: the sentence under the
 * heading below splits the suite across three workspaces, and exactly one of
 * the three can be counted from inside it.
 */
export const WEB_TEST_FILES = 34

type TestGroup = { title: string; files: string; body: string }

/**
 * What the suite actually pins, in the words of the assertions themselves.
 *
 * "Covers the repository layer" tells a reader nothing and cannot be checked.
 * Each line below is a real test, paraphrased only enough to read as English,
 * so someone deciding whether to trust the suite can go and find it.
 */
const TEST_GROUPS: TestGroup[] = [
  {
    title: 'The pure algebra',
    files: 'core/algebra · ref · schema · address · parse-posting',
    body: 'Shortest path returns null across disconnected components rather than inventing a route; hiding a type from the graph legend leaves every remaining node’s degree at its full-graph value; two records created inside one transaction cannot end up sharing a slug.',
  },
  {
    title: 'The projection round trip',
    files: 'core/project · react/projections',
    body: 'A projection hands back the identical array when nothing changed and re-projects only the row that did — which is the whole reason a 60-card board survives an edit. The seeded graph boots, projects every collection back at its fixture size, and re-derives daysAgo from lastActionAt to exactly the number the fixture stated.',
  },
  {
    title: 'The tool undo contract',
    files: 'tools/tools · repo/journal',
    body: 'Adding an application writes the record, its employer and its deadline in one commit; deleting it and undoing puts every one of its edges back; a nested tool that fails discards every write made above it. Deleting a record five others point at unlinks five and relinks five on undo.',
  },
  {
    title: 'The IndexedDB round trip and the migrations',
    files: 'storage/idb-driver · memory-driver',
    body: 'Seed, write, close, reopen, and get back exactly what went in; all four object stores commit or none of them do; a migration carries every row from v1 to v2, and a step that throws rolls the whole upgrade back with the old version intact. A blocked upgrade gives up rather than hanging forever.',
  },
  {
    title: 'Boot, and what happens when the disk says no',
    files: 'repo/boot · queue · repository · meta · seed',
    body: 'A store you emptied is not quietly reseeded on the next launch; a store that will not open falls back to an in-memory session and never fabricates records to fill it. The write queue drains on a microtask without being awaited, and when a write fails it keeps the operations and counts how many of your actions are stranded rather than how many rows.',
  },
]

export function CodeStructure() {
  return (
    <>
      <section>
        <h2 className="mb-3 text-base font-medium">
          Which layer a change belongs in
          <small className="ml-2 font-sans text-xs font-normal text-text-3">
            the differences the drawing cannot show
          </small>
        </h2>

        <p className="text-sm text-text-2">
          The stack above says which direction imports may point. It does not say where a new file
          goes, and that is settled by what each layer is allowed to do that its neighbours are not.
          Two of these are not visible in any drawing of a stack:{' '}
          <span className="font-mono text-xs">storage</span> sits at the bottom but never imports{' '}
          <span className="font-mono text-xs">core</span>, and{' '}
          <span className="font-mono text-xs">tools</span> reaches{' '}
          <span className="font-mono text-xs">repo</span> for a type and nothing else.
        </p>

        <Panel className="mt-3.5 sm:mt-4">
          <dl className="divide-y divide-hairline text-sm">
            {LAYER_FACTS.map((layer) => (
              <div key={layer.name} className="py-3 first:pt-0 last:pb-0 sm:flex sm:gap-4">
                <dt className="shrink-0 font-mono text-xs text-text-1 sm:basis-28 sm:pt-0.5">
                  {layer.name}
                </dt>
                <dd className="mt-1 min-w-0 text-text-2 sm:mt-0">{layer.only}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium">
          Why the boundary is there at all
          <small className="ml-2 font-sans text-xs font-normal text-text-3">
            one service layer, three platforms
          </small>
        </h2>
        <Panel>
          <p className="text-sm text-text-2">
            The store is meant to be the same code in a browser, in React Native and inside
            Electron. Nothing about a job application is web-specific; what is web-specific is where
            the bytes land and how a keystroke arrives. So the platform enters through three named
            ports and nowhere else — <span className="font-mono text-xs">Driver</span> for
            durability, <span className="font-mono text-xs">Host</span> for what the graph needs a
            platform to tell it, and a toast interface for what it needs a platform to say.{' '}
            <span className="font-mono text-xs">Host</span> and the toast are implemented in{' '}
            <span className="font-mono text-xs">src/lib</span>, which is web-only and allowed to be;
            the <span className="font-mono text-xs">Driver</span> is nine files rather than a
            binding and lives at <span className="font-mono text-xs">src/kg/storage</span>, which is
            web-only too and compiled under the package&rsquo;s own strictness rather than the
            app&rsquo;s.
          </p>
          <p className="mt-2.5 text-sm text-text-2">
            Storage is a port with three implementations, and all three ship:{' '}
            <span className="font-mono text-xs">idb-driver.ts</span> is the real one here,{' '}
            <span className="font-mono text-xs">rn-driver.ts</span> over AsyncStorage is the real
            one on the phone, and <span className="font-mono text-xs">memory-driver.ts</span> is
            what every test runs against and what this app falls back to when a browser refuses to
            open a database at all. That fallback is not a test fixture pressed into service — it is
            why private browsing still runs the app rather than showing you an error page.
          </p>
          {/* This paragraph used to say that nothing had mounted the layer
              anywhere else and that mobile was running a drifted copy of it.
              Both stopped being true in one week, on the page a contributor
              reads first, and nothing in the gate can see a wrong sentence
              inside a rendered element. The rule it was written under is still
              the right one and is why it wanted rewriting rather than deleting:
              say what has actually been run, and let the reader see where the
              evidence stops. */}
          <p className="mt-2.5 text-sm text-text-2">
            The React Native app under <span className="font-mono text-xs">mobile/</span> imports
            this package now. Its copy of the layer — which had drifted 813 lines in four months —
            is deleted, and what is left under{' '}
            <span className="font-mono text-xs">mobile/src/kg</span> is the AsyncStorage driver and
            nothing else. Web, Android and iOS have each been run against the same seeded fixtures
            and the numbers on screen compared.
          </p>
          <p className="mt-2.5 text-sm text-text-2">
            Where the evidence stops: Electron is still a sentence at the top of this panel and not
            a build, and a copy that has been edited is a copy no guard can see — so &ldquo;both
            apps share this layer&rdquo; is a claim to keep re-checking rather than one the boundary
            proves on its own.
          </p>
        </Panel>
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium">
          What holds the rule up
          <small className="ml-2 font-sans text-xs font-normal text-text-3">
            three scripts, and the compiler
          </small>
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
          <Panel>
            <PanelTitle hint="a regex, deliberately">check-layers.mjs</PanelTitle>
            <p className="text-sm text-text-2">
              It reads import lines and nothing else, which is enough to reject a file under{' '}
              <span className="font-mono text-xs">service/kg</span> importing from{' '}
              <span className="font-mono text-xs">@/components</span>, a layer importing one it may
              not, a <span className="font-mono text-xs">.tsx</span> outside{' '}
              <span className="font-mono text-xs">kg/react</span>, and any module at all importing
              the app&rsquo;s <span className="font-mono text-xs">TODAY</span>.
            </p>
            <p className="mt-2.5 text-sm text-text-2">
              A regex rather than a parser on purpose: the thing being matched is a string literal
              at a fixed position, and taking on a parser to read one would be a layer violation of
              its own kind. A missed exotic spelling costs a review comment; a false alarm costs the
              guard, because a rule that fires on correct code is a rule somebody deletes.
            </p>
          </Panel>

          <Panel>
            <PanelTitle hint="a parser, just as deliberately">check-platform.mjs</PanelTitle>
            <p className="text-sm text-text-2">
              The other half of the boundary is not an import.{' '}
              <span className="font-mono text-xs">window.addEventListener</span> is a global, so no
              amount of reading import lines will ever see it — and a grep for these names is
              useless here: of 28 naive matches under{' '}
              <span className="font-mono text-xs">service/kg</span>, 23 are prose in a comment or a
              domain noun like <span className="font-mono text-xs">application.location</span>.
            </p>
            <p className="mt-2.5 text-sm text-text-2">
              So it parses, and reports a name only where it is a free identifier being read and is
              not declared anywhere in that file. Its exemption list shipped empty and stays empty:
              an entry that stops matching is itself reported as a failure, so it cannot outlive the
              violation it was written to excuse.
            </p>
          </Panel>
        </div>

        {/* Added late, because the guard is newer than the page — and it was
            the wrong one to be missing. The other two are about the code that
            is here; this is the one about there being a second copy of it,
            which is the whole subject of the section above. */}
        <Panel className="mt-4 sm:mt-5">
          <PanelTitle hint="identity, never similarity">check-no-copies.mjs</PanelTitle>
          <p className="text-sm text-text-2">
            The other two check the code that is here; this one checks that there is only one of it.
            It exists because of a measurement rather than a principle:{' '}
            <span className="font-mono text-xs">mobile/src/kg</span> was a <Kbd>cp -R</Kbd> of this
            app&rsquo;s, it drifted 813 lines over four months, and nothing in either app&rsquo;s
            lint could see it. Import specifiers are canonicalised before hashing, because rewriting
            them is the one edit a paste into a second app always makes — comparing raw bytes would
            have missed the copy that actually happened, on its first day.
          </p>
          <p className="mt-2.5 text-sm text-text-2">
            It is deliberately not a similarity metric: a near-duplicate detector is a tuning
            parameter and an argument, and identity is neither. Something 90% copied and then edited
            is a fork this guard will not catch, and it says so in its own header — the layer rules,
            the shared conformance contract and one test suite are what have to cover that case.
          </p>
        </Panel>

        <Panel className="mt-4 sm:mt-5">
          <PanelTitle hint="the earliest of the four">The compiler carries it too</PanelTitle>
          <p className="text-sm text-text-2">
            <span className="font-mono text-xs">service/tsconfig.core.json</span> compiles core,
            repo and tools with <Kbd>&quot;lib&quot;: [&quot;ES2023&quot;]</Kbd> and{' '}
            <Kbd>&quot;types&quot;: []</Kbd>;{' '}
            <span className="font-mono text-xs">service/tsconfig.react.json</span> does the same for
            the hooks, admitting React and nothing else. No DOM library and no ambient types means{' '}
            <span className="font-mono text-xs">document</span> and{' '}
            <span className="font-mono text-xs">process</span> are not names those directories can
            spell, so a stray one is a compile error rather than a review comment.
          </p>
          {/* Named rather than described. The abstract version of this argument
              reads as taste; the incident does not, and it is the reason all
              three checks exist instead of whichever one came first. */}
          <p className="mt-2.5 text-sm text-text-2">
            None of these made the others redundant, and there is a specific reason for that. A lib
            setting is per project while the script is per layer — &ldquo;no timers anywhere under
            service/kg&rdquo; would be the wrong rule, since a retry backoff belongs in the write
            queue and nowhere else. And the rules exist at all because a{' '}
            <span className="font-mono text-xs">window</span> listener once sat inside{' '}
            <span className="font-mono text-xs">kg/react/kg.tsx</span> through a clean{' '}
            <Kbd>tsc -b</Kbd>, <Kbd>npm test</Kbd> and <Kbd>npm run lint</Kbd>. On React Native that
            line is not a type error somebody reviews. It is a crash at mount.
          </p>
        </Panel>
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium">
          One feature, traced through the layers
          <small className="ml-2 font-sans text-xs font-normal text-text-3">
            adding an application
          </small>
        </h2>

        <p className="text-sm text-text-2">
          Adding an application is the useful example because it is not one write. It files the
          record, finds or creates the employer, and puts a deadline on the calendar — and it used
          to be four writes sitting in a component with nothing making them atomic, so a failure
          halfway through left a record tagged with keywords and missing the deadline the toast had
          just promised was on the calendar.
        </p>

        <Panel className="mt-3.5 sm:mt-4">
          <ToolTraceDiagram />
        </Panel>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-2">
          <Panel>
            <PanelTitle hint="step 3 above">A write is always a named tool</PanelTitle>
            <p className="text-sm text-text-2">
              The registry is a single <span className="font-mono text-xs">const</span> object, so a
              misspelt tool name is a compile error rather than a no-op discovered later. Names are{' '}
              <span className="font-mono text-xs">domain.noun.verb</span> from a closed verb set,
              and a loop at module load throws if a tool is filed under a key it does not call
              itself — an entry in the wrong slot would otherwise surface months later as the wrong
              label in an undo toast.
            </p>
            <p className="mt-2.5 text-sm text-text-2">
              Anything that writes nothing is not a tool. Copy-to-clipboard is absent on purpose;
              keeping that line sharp is what stops the registry becoming a list of every{' '}
              <span className="font-mono text-xs">onClick</span> in the app.
            </p>
          </Panel>

          <Panel>
            <PanelTitle hint="steps 3 to 5 above">One action, one commit, one undo</PanelTitle>
            <p className="text-sm text-text-2">
              A nested <span className="font-mono text-xs">ctx.call</span> joins the transaction its
              caller opened rather than starting its own, so three tools produce one commit, one
              journal row and one Undo — instead of three toasts and an undo that puts back a third
              of what you just did.
            </p>
            <p className="mt-2.5 text-sm text-text-2">
              The journal stores before and after images captured by the transaction, not inverse
              commands. That is what replaced 42 hand-written undo closures with none: an inverse
              &ldquo;create&rdquo; mints a fresh id and orphans every edge that pointed at the old
              one, and no inverse command knows about the six places a delete had to unlink.
            </p>
          </Panel>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium">
          The shape of what you are walking into
          <small className="ml-2 font-sans text-xs font-normal text-text-3">
            measured, each directory&rsquo;s own tests included
          </small>
        </h2>

        <Panel>
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full min-w-[26rem] border-collapse text-sm">
              <caption className="sr-only">
                Files, test files and lines per directory, with what each one holds
              </caption>
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-text-3">
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Directory
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Files
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Tests
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Lines
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    What is in it
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {SHAPE.map((row) => (
                  <tr key={row.dir}>
                    <th
                      scope="row"
                      className="py-2 pr-3 text-left font-mono text-xs font-normal whitespace-nowrap text-text-1"
                    >
                      {row.dir}
                    </th>
                    <td className="py-2 pr-3 text-right text-text-2 tabular-nums">{row.files}</td>
                    <td className="py-2 pr-3 text-right text-text-3 tabular-nums">
                      {row.tests === 0 ? '—' : row.tests}
                    </td>
                    <td className="py-2 pr-3 text-right text-text-2 tabular-nums">
                      {row.lines.toLocaleString('en-GB')}
                    </td>
                    <td className="py-2 text-text-2">{row.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* These numbers go stale and there is no way for a reader to tell
              that they have. Printing the command is the only honest form: it
              costs one line and it makes the whole table checkable. */}
          <p className="mt-3.5 text-xs text-text-3">
            Counted on the tree these pages were written against, tests included, with{' '}
            <Kbd>find service/kg/core -name &apos;*.ts*&apos; | xargs wc -l</Kbd>. Re-run it rather
            than trusting it — <span className="font-mono">web/src/components</span> in particular
            moves whenever anything ships.
          </p>
        </Panel>
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium">
          What the tests actually pin
          <small className="ml-2 font-sans text-xs font-normal text-text-3">
            73 files, 915 tests, about five seconds
          </small>
        </h2>

        <p className="text-sm text-text-2">
          Vitest in a node environment, with{' '}
          <span className="font-mono text-xs">fake-indexeddb</span> standing in for the
          browser&rsquo;s database. 34 of those files sit in{' '}
          <span className="font-mono text-xs">service/</span>, the package both apps import, and
          hold 517 of the tests; 29 are this app and 10 are the phone. That ratio is the one the
          project intends: the package is the code whose failure is silent and permanent, and
          local-first means there is nothing to restore from.
        </p>

        {/* Same reasoning as the table above, and the same remedy: three
            workspaces now write into this number and a reader has no way to
            tell how old it is. One of the three is checked — the count of this
            app's own test files is pinned by `code-structure.test.ts`, which
            can glob `src` and cannot reach the other two workspaces. */}
        <p className="mt-2.5 text-xs text-text-3">
          Counted with <Kbd>npm test</Kbd> in each of <span className="font-mono">service</span>,{' '}
          <span className="font-mono">web</span> and <span className="font-mono">mobile</span>. The
          29 in this app are re-counted by the suite itself; the other two move under a workspace
          this app cannot see, so re-run it rather than trusting it.
        </p>

        <Panel className="mt-3.5 sm:mt-4">
          <dl className="divide-y divide-hairline text-sm">
            {TEST_GROUPS.map((group) => (
              <div key={group.title} className="py-3 first:pt-0 last:pb-0">
                <dt className="font-medium">
                  {group.title}
                  <span className="ml-2 font-mono text-xs font-normal text-text-3">
                    {group.files}
                  </span>
                </dt>
                <dd className="mt-1 text-text-2">{group.body}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="mt-4 sm:mt-5">
          <PanelTitle hint="and why that is a decision">Nothing here mounts a component</PanelTitle>
          <p className="text-sm text-text-2">
            No jsdom, no testing-library, nothing that renders a tree. The interface is checked by
            the type system and by hand, and the effort went to the layer where a mistake loses your
            records rather than the layer where a mistake looks wrong. It is also why the suite
            finishes in about a second — which is the property that decides whether anyone runs it
            before a commit, and therefore whether it catches anything at all.
          </p>
        </Panel>
      </section>
    </>
  )
}
