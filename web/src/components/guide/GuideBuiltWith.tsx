import type { ReactNode } from 'react'
import { Chip } from '@/components/common/Chip'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { CodeStructure } from '@/components/guide/CodeStructure'
import { GuideContents } from '@/components/guide/GuideNav'
import { ImportRule } from '@/components/guide/ImportRule'
import {
  DEVELOPMENT,
  ISC_TEXT,
  MIT_TEXT,
  PHONE,
  RUNTIME,
  type Credit,
} from '@/components/guide/credits'
import { useTitle } from '@/lib/links'

/**
 * Page 4 — acknowledgements, plus the few repo facts a contributor needs first.
 *
 * Last because provenance is the one thing nobody has to read to use the app,
 * and its own page because it has a different update cadence from everything
 * else here: it changes when package.json changes and at no other time.
 *
 * One thing on this page is unusual and it is deliberate.
 *
 * It says out loud where the provenance runs out: one package states no
 * licence at all, and two vendored images have no recorded source. Both are
 * named rather than smoothed over. A credits page is the one page in an app
 * where a confident guess is worse than an admitted gap, because a reader has
 * no way to tell the two apart and every other line loses its weight.
 *
 * This page listed three packages that did nothing until 0.1.0 — `react-icons`,
 * `@dnd-kit/sortable` and `@dnd-kit/utilities`, installed and imported nowhere.
 * Naming them here rather than quietly crediting them is what made them easy to
 * find and delete; `react-icons` alone was 85 MB of install for no import. The
 * page is now a list of packages that all earn their place, and the rule that
 * got it there stands: credit what is installed, say what it does, and where it
 * does nothing, say that.
 *
 * The list itself is in `credits.ts` — data, so the page is one shape and the
 * next `npm install` has one file to reconcile.
 */
export function GuideBuiltWith() {
  useTitle('Built with')

  return (
    <>
      <PageHeader
        title="Built with"
        subtitle="The open-source work jojo is made of, and how the code around it is arranged."
      />

      <Panel>
        <PanelTitle hint="read from node_modules, not from package.json">
          How this list was made
        </PanelTitle>
        <div className="space-y-2 text-sm text-text-2">
          <p>
            Every version below is the one actually installed, and every licence is the one the
            package states — taken from its own manifest, or from the licence file beside it where
            the manifest says nothing. Neither is inferred from the other and neither is guessed.
          </p>
          <p>
            That matters more than it sounds.{' '}
            <span className="font-mono text-xs break-all">package.json</span> holds ranges rather
            than versions, so a page built from it names software nobody is running. And the obvious
            guess is wrong often enough to be worthless: two of these are ISC rather than MIT, three
            are Apache-2.0, the two typefaces are under the SIL Open Font License, and one states
            nothing at all.
          </p>
          <p>
            No request is made from this page — the licence texts below are part of the app, like
            everything else here.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelTitle hint={`${RUNTIME.length} packages`}>In the app</PanelTitle>
        <p className="mb-3 text-sm text-text-2">What ships to the browser and does the work.</p>
        <CreditList credits={RUNTIME} />
      </Panel>

      <Panel>
        <PanelTitle hint={`${PHONE.length} packages`}>In the phone app</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          None of this is in the bundle you are reading — a browser never loads React Native. It is
          here because the phone app has no acknowledgements page of its own, and a dependency with
          nowhere to be credited is a dependency that is not credited.
        </p>
        <CreditList credits={PHONE} />
      </Panel>

      <Panel>
        <PanelTitle hint={`${DEVELOPMENT.length} packages`}>Around the code</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          The build, the tests and the checks. None of this reaches a browser — it is here because
          the source ships with it, not the app.
        </p>
        <CreditList credits={DEVELOPMENT} />
      </Panel>

      <Panel>
        <PanelTitle>Credits that are not packages</PanelTitle>
        <div className="divide-y divide-hairline text-sm">
          <OtherCredit
            title="Inter, and JetBrains Mono"
            meta="SIL Open Font License 1.1"
            body={
              <>
                Inter is by Rasmus Andersson and the Inter Project Authors; JetBrains Mono is by
                JetBrains and the JetBrains Mono Project Authors. Both are self-hosted from their{' '}
                <span className="font-mono text-xs break-all">@fontsource-variable</span> packages,
                which is why loading jojo fetches no font from anyone else&rsquo;s server. The OFL
                asks that the copyright notice and the licence travel with the font files; both do,
                inside those packages, and the notices are listed above. Reserved Font Names apply —
                a modified copy of either face may not keep its name.
              </>
            }
          />
          <OtherCredit
            title="The robot mascot"
            meta="a Spline scene, vendored into this repository"
            body={
              <>
                The scene in the sidebar is a Spline export, served from this app&rsquo;s own origin
                as <span className="font-mono text-xs break-all">public/mascot.splinecode</span>{' '}
                rather than from Spline&rsquo;s CDN — a request on a page carrying somebody&rsquo;s
                job applications would have made the promise on the dashboard false. The runtime
                needs a 492kB WebAssembly module to build the scene&rsquo;s geometry, and that is
                vendored too, at{' '}
                <span className="font-mono text-xs break-all">public/spline/process.wasm</span>,
                from <span className="font-mono text-xs break-all">@splinetool/modelling-wasm</span>{' '}
                at the version matching the runtime. Credit to Spline, Inc. The scene asset&rsquo;s
                own terms are a separate grant from the npm package&rsquo;s and have to be confirmed
                separately — that has not been done here.
              </>
            }
          />
          <OtherCredit
            title="shadcn/ui"
            meta="MIT — patterns and generated files, not a dependency at runtime"
            body={
              <>
                The thirteen components in{' '}
                <span className="font-mono text-xs break-all">src/components/ui</span> — button,
                command, dialog, input, input group, label, popover, separator, spotlight, splite,
                switch, textarea, toast — began as shadcn/ui output and live in this repository,
                edited since. The app does not import them from a package; it owns them. Copyright
                (c) 2023 shadcn.
              </>
            }
          />
          <OtherCredit
            title="Radix UI primitives"
            meta="MIT — Copyright (c) 2022 WorkOS"
            body="Underneath those skins is Radix: the focus trap, the Escape handling, the modality, the roving focus in a menu, and returning focus to whatever opened an overlay. It is the half of a dialog nobody notices until it is missing, and this app has had to fix that half twice."
          />
          <OtherCredit
            title="Lucide, and Feather"
            meta="ISC, with an MIT notice for part of the set"
            body={
              <>
                Lucide is ISC — Copyright (c) 2026 Lucide Icons and Contributors. Lucide began as a
                fork of Feather, and the icons carried over from it keep a second notice: MIT,
                Copyright (c) 2013–present Cole Bemis. Several of those are in use here, among them
                check, search, clock, command, link and calendar. Both notices are reproduced below.
              </>
            }
          />
          <OtherCredit
            title="Two images in the transfer scene"
            meta="source not recorded"
            warn
            body={
              <>
                <span className="font-mono text-xs break-all">public/transfer/scene.png</span> and{' '}
                <span className="font-mono text-xs break-all">scene-depth.webp</span> were pulled
                from a third-party image host by an earlier version of that page and vendored into
                this repository to stop the request. Where they originally came from is not written
                down anywhere in the history, so nothing is claimed about them and nobody is
                credited for them. That is a gap to close before this app is distributed, not a
                licence.
              </>
            }
          />
          <OtherCredit
            title="Software jojo talks to but does not ship"
            meta="MarkItDown, and whichever model server you run"
            body={
              <>
                Two programs jojo can reach, both installed and run by you, both at an address you
                type into Settings. Neither is bundled into either app and no code from either is in
                this repository. <span className="text-text-1">MarkItDown</span> is
                Microsoft&rsquo;s, MIT-licensed, and converts your documents — and a job posting,
                when you add an application from a link — to text the model can read. The{' '}
                <span className="text-text-1">model server</span> is whichever you point at:{' '}
                <span className="font-mono text-xs break-all">vLLM</span>,{' '}
                <span className="font-mono text-xs break-all">Ollama</span>,{' '}
                <span className="font-mono text-xs break-all">LM Studio</span> or anything else
                speaking the OpenAI-compatible chat-completions shape. Their names are theirs; jojo
                is not affiliated with, endorsed by or sponsored by any of them. MarkItDown&rsquo;s
                licence is reproduced in full in{' '}
                <span className="font-mono text-xs break-all">THIRD-PARTY-NOTICES.md</span> at the
                root; the model servers are named rather than licensed here because jojo neither
                ships nor requires any particular one.
              </>
            }
          />
          <OtherCredit
            title="jojo itself"
            meta="MIT — Copyright (c) 2026 Shaswata Mitra"
            body={
              <>
                The full text is in <span className="font-mono text-xs break-all">LICENSE</span> at
                the root of the repository, and it is the same three paragraphs reproduced below.
              </>
            }
          />
        </div>
      </Panel>

      <Panel>
        <PanelTitle hint="reproduced in full">Licence texts</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          MIT and ISC both ask that the copyright notice and the permission notice travel with the
          software. The notices are listed against each package above; these are the texts they
          attach to.
        </p>

        <LicenceText name="The MIT License" text={MIT_TEXT} />
        <LicenceText name="The ISC License" text={ISC_TEXT} />

        <div className="mt-4 space-y-2 border-t border-hairline pt-4 text-sm text-text-2">
          <p>
            <span className="font-medium text-text-1">Apache License 2.0</span> — covering{' '}
            <span className="font-mono text-xs break-all">class-variance-authority</span>,{' '}
            <span className="font-mono text-xs break-all">typescript</span> and{' '}
            <span className="font-mono text-xs break-all">fake-indexeddb</span>. It runs to some
            eleven thousand words and is not reproduced here; the full text ships with each of those
            packages, at{' '}
            <span className="font-mono text-xs break-all">
              node_modules/&lt;package&gt;/LICENSE
            </span>
            . None of the three carries a NOTICE file, so there is no additional attribution text to
            pass on.
          </p>
          <p>
            <span className="font-medium text-text-1">SIL Open Font License 1.1</span> — covering
            the two typefaces. Its full text ships inside each font package, and the copyright lines
            and Reserved Font Names are given above.
          </p>
          <p>
            <span className="font-medium text-text-1">@splinetool/runtime</span> states no licence
            in its manifest and ships no licence file. That is recorded here as an absence rather
            than filled in from what its sibling package happens to say.
          </p>
        </div>
      </Panel>

      <section>
        <h2 className="mb-3 text-base font-medium">
          How the code is arranged
          <small className="ml-2 font-sans text-xs font-normal text-text-3">
            for anyone opening the repository
          </small>
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:gap-5">
          <Panel>
            <PanelTitle hint="service/kg">One rule, and two scripts that hold it</PanelTitle>
            <p className="mb-3.5 text-sm text-text-2">
              Everything about your records — the model, the writes, the storage — sits under one
              directory in five layers, and the whole architecture is a single rule about which of
              them may import which.
            </p>
            <ImportRule />
          </Panel>

          <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
            <Panel>
              <PanelTitle hint="62">Every write is a named operation</PanelTitle>
              <p className="text-sm text-text-2">
                Not "save this object" —{' '}
                <span className="font-mono text-xs break-all">application.create</span>,{' '}
                <span className="font-mono text-xs break-all">timeline.item.snooze</span>,{' '}
                <span className="font-mono text-xs break-all">keyword.detach</span>. One registry
                holds all 62, which is what the ⌘K palette runs, what the audit log lists by name,
                and what the undo message is titled after. An action that writes nothing is not one
                of them.
              </p>
            </Panel>

            <Panel>
              <PanelTitle hint="57 files, 697 tests">Tested where it counts</PanelTitle>
              <p className="text-sm text-text-2">
                31 of those files are in{' '}
                <span className="font-mono text-xs break-all">service/</span>, the package both apps
                import, against a real IndexedDB implementation running in Node. There are no
                component tests and no browser in the suite — a deliberate line: the record model is
                where a silent mistake costs you data, and the whole thing runs in about three
                seconds, which is what makes anyone run it.
              </p>
            </Panel>

            <Panel>
              <PanelTitle hint="all four, every time">What has to pass</PanelTitle>
              <ul className="space-y-1.5 text-sm text-text-2">
                <li>
                  <span className="font-mono text-xs text-text-1">tsc -b</span> — four projects, and
                  the portable ones compile without the DOM in scope.
                </li>
                <li>
                  <span className="font-mono text-xs text-text-1">npm test</span>
                </li>
                <li>
                  <span className="font-mono text-xs text-text-1">npm run lint</span> — the linter,
                  then three guards: the two drawn above, and the one that fails when a second copy
                  of the layer starts coming back.
                </li>
                <li>
                  <span className="font-mono text-xs text-text-1">prettier</span> — so no diff here
                  is about whitespace.
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      </section>

      {/* The rest of the same subject, one level deeper: which layer a change
          belongs in, why the boundary was drawn, one real feature traced across
          it, the measured size of each directory, and what the suite pins.
          Kept in its own file rather than inlined here because this page has
          two update cadences — the credits above change when package.json does,
          and nothing else on the page changes then. */}
      <CodeStructure />

      {/* The last page of the section, so it ends with a way back rather than
          with a pager arrow that has nowhere to point. */}
      <GuideContents />
    </>
  )
}

function CreditList({ credits }: { credits: readonly Credit[] }) {
  return (
    <ul className="divide-y divide-hairline">
      {credits.map((credit) => (
        <li key={credit.name} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-medium text-text-1">{credit.name}</span>
            <span className="tabular font-mono text-xs text-text-3">{credit.version}</span>
            {/* The licence is the reason this page exists, so it is the one
                thing on the row that carries a border and a fill. "Not stated"
                is amber rather than grey: it is a thing to resolve, not a
                neutral fact about a package. */}
            {credit.licence ? (
              <Chip size="sm">{credit.licence}</Chip>
            ) : (
              <Chip size="sm" tone="amber">
                licence not stated
              </Chip>
            )}
          </div>
          <p className="mt-1 text-sm text-text-2">{credit.what}</p>
          <p className="mt-1 text-xs text-text-3">
            {credit.holder ? <>Copyright {credit.holder}. </> : null}
            {credit.where ? <span className="font-mono">{credit.where}</span> : null}
          </p>
        </li>
      ))}
    </ul>
  )
}

/**
 * One credit that did not come from npm — a typeface, an asset, a set of
 * patterns.
 *
 * Not called `Credit`: that name is taken by the data type imported at the top
 * of this file, and a component sharing a name with a type in the same module
 * is a rename waiting to go wrong. These have no version and no manifest to
 * read, which is exactly why they are the entries most often left off a page
 * like this one.
 */
function OtherCredit({
  title,
  meta,
  body,
  warn,
}: {
  title: string
  meta: string
  body: ReactNode
  /** For a credit that is a known gap rather than a settled attribution. */
  warn?: true
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-text-1">{title}</span>
        <span className={warn ? 'text-xs text-warning' : 'text-xs text-text-3'}>{meta}</span>
      </p>
      <p className="mt-1 text-sm text-text-2">{body}</p>
    </div>
  )
}

/**
 * A licence, quoted.
 *
 * `whitespace-pre-line` rather than a <pre>: the paragraph breaks in these
 * texts are meaningful and the line breaks are not, so preserving the newlines
 * while letting the lines rewrap is what keeps a 70-column legal text readable
 * on a 390px phone without a horizontal scroller.
 */
function LicenceText({ name, text }: { name: string; text: string }) {
  return (
    <div className="mt-3 first:mt-0">
      <h3 className="text-sm font-medium">{name}</h3>
      <blockquote className="mt-1.5 border-l-2 border-hairline pl-3 text-xs whitespace-pre-line text-text-3">
        {text}
      </blockquote>
    </div>
  )
}
