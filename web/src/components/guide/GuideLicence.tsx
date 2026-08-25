import type { ReactNode } from 'react'
import { Chip } from '@/components/common/Chip'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { GuideContents } from '@/components/guide/GuideNav'
import { MIT_TEXT } from '@/components/guide/credits'
import { useTitle } from '@/lib/links'

/**
 * Page 6 — what jojo costs, what you may do with it, and whose rules you take on
 * when you point it at somebody else's service.
 *
 * ## Why this is separate from "Built with"
 *
 * That page is ATTRIBUTION: what jojo is made of, who wrote it, which licence
 * each package states. This one is OBLIGATION: what a person reading it is
 * allowed to do, and what they are agreeing to. The two answer different
 * questions and have different update cadences — attribution changes when
 * `package.json` does, obligation changes when a vendor rewrites their terms,
 * which they do without telling anybody.
 *
 * ## The rule this page is written under
 *
 * Every claim here is either quoted from a licence or checked against one, and
 * where the answer is uncomfortable it is written down anyway. Two are:
 * `@splinetool/runtime` ships in the bundle with no licence grant at all, and
 * NVIDIA's free API is licensed for evaluation and explicitly not for
 * production — which is what most people will actually use it for. A licence
 * page that omitted either would be worse than no page, because a reader has no
 * way to tell a careful list from a comfortable one.
 *
 * It is not legal advice and says so. What it can honestly be is a map of where
 * the obligations are, so somebody who needs advice knows what to ask about.
 */
export function GuideLicence() {
  useTitle('Licence')

  return (
    <>
      <PageHeader
        title="Licence"
        subtitle="jojo is MIT-licensed and free to use. The services you can point it at are not jojo's, and they come with their own terms."
      />

      {/* ------------------------------------------------------ jojo itself */}
      <Panel>
        <PanelTitle hint="MIT · free for any use, including commercial">
          jojo’s own licence
        </PanelTitle>
        <div className="space-y-2.5 text-sm text-text-2">
          <p>
            <span className="text-text-1">
              jojo is open source under the MIT licence, © 2026 Shaswata Mitra.
            </span>{' '}
            You may use it, copy it, change it, and ship it in something you sell. There is no fee,
            no account, no licence key and no per-seat anything. The full text is in{' '}
            <span className="font-mono text-xs">LICENSE</span> at the root of the repository and is
            quoted at the foot of this page.
          </p>
          <p>
            The two conditions are the ones MIT always carries, and they are short. Keep the
            copyright notice and the permission notice with any substantial copy you distribute. And
            accept that it comes with <span className="text-text-1">no warranty of any kind</span> —
            see the disclaimer below, which is not boilerplate here.
          </p>
        </div>
      </Panel>

      {/* ------------------------------------------------- what you run it on */}
      <Panel>
        <PanelTitle hint="jojo is a client; it is not a party to these">
          The services you point it at
        </PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          jojo ships no API key and calls nothing on its own. Every connection below is one{' '}
          <span className="text-text-1">you</span> configure with{' '}
          <span className="text-text-1">your</span> credentials, which makes you — not this project
          — the party to that provider’s agreement. What jojo owes you is an accurate account of
          what you are agreeing to.
        </p>

        <div className="divide-y divide-hairline">
          <Term
            title="NVIDIA (build.nvidia.com)"
            chip={<Chip tone="amber">Evaluation only</Chip>}
            body={
              <>
                <p>
                  The free API catalogue is licensed for trial use. NVIDIA’s API Trial Terms of
                  Service say you may use it{' '}
                  <span className="text-text-1">
                    “for internal testing and evaluation purposes, not in production”
                  </span>{' '}
                  unless you buy a subscription, and that access is{' '}
                  <span className="text-text-1">
                    “for limited trial purposes only and without use of the API Service or Generated
                    Content in production”
                  </span>
                  . Running your actual job search on it, day after day, is not what that permits.
                  The documented production route is to self-host an NVIDIA NIM container under a
                  separate licence.
                </p>
                <p className="mt-2">
                  The same terms tell you{' '}
                  <span className="text-text-1">not to upload personal data</span>: “you will not
                  upload any personal information relating to an identifiable individual, financial,
                  health or governmental information”. jojo’s assistant sends your profile, your CV
                  text, salary figures, and the names and email addresses of referees and recruiters
                  — people who never agreed to anything. NVIDIA specifically disclaims that its
                  servers are appropriate for processing personal data.
                </p>
                <p className="mt-2">
                  And submitting content grants NVIDIA a worldwide licence to “use, host, store,
                  reproduce, modify, create derivative works … display and transmit” it. That is
                  ordinary for a free tier and it is not what “local-first” means, so it is said
                  here plainly.
                </p>
              </>
            }
          />

          <Term
            title="Anthropic · OpenAI · OpenRouter · Groq"
            chip={<Chip tone="gray">Billed to you</Chip>}
            body={
              <p>
                Paid APIs under each vendor’s own commercial terms, which generally do permit
                production use — that is what you are paying for. Your key, your account, your bill.
                Read the one you choose: they differ on whether prompts may be retained, whether
                they may be used for training, and what you may build. jojo does not negotiate any
                of that on your behalf and cannot.
              </p>
            }
          />

          <Term
            title="MarkItDown (Microsoft)"
            chip={<Chip tone="green">MIT · nothing shipped</Chip>}
            body={
              <p>
                The document reader is Microsoft’s MarkItDown, MIT-licensed. jojo{' '}
                <span className="text-text-1">bundles none of it</span> — it speaks to a copy{' '}
                <span className="text-text-1">you</span> run on your own machine over MCP, so no
                Microsoft code is redistributed here and its licence conditions attach to your copy
                rather than to jojo. The full notice is in{' '}
                <span className="font-mono text-xs">THIRD-PARTY-NOTICES.md</span>. “MarkItDown” and
                “Microsoft” are Microsoft’s marks; naming the program jojo talks to is not a claim
                of endorsement or affiliation.
              </p>
            }
          />

          <Term
            title="Ollama · vLLM · LM Studio · llama.cpp"
            chip={<Chip tone="green">Nothing leaves</Chip>}
            body={
              <p>
                A local server you run. Nothing is sent anywhere and no third-party terms come into
                it — the model weights you load have their own licences, which are between you and
                whoever published them. This is the configuration with the fewest strings attached,
                and it is why it is the default.
              </p>
            }
          />
        </div>
      </Panel>

      {/* ------------------------------------------------------ the open gap */}
      <Panel>
        <PanelTitle hint="named rather than smoothed over">
          Where the provenance runs out
        </PanelTitle>
        <div className="space-y-2.5 text-sm text-text-2">
          <p>
            <span className="text-text-1">
              The 3D mascot’s runtime ships with no licence grant.
            </span>{' '}
            <span className="font-mono text-xs">@splinetool/runtime</span> declares no{' '}
            <span className="font-mono text-xs">license</span> field, carries no LICENSE file,
            records nothing in the lockfile, and describes itself as “© 2025 Spline, Inc.”. It is
            compiled into the published bundle. Absent a grant there is no stated permission to
            redistribute it, which is a real question for anyone forking or deploying jojo — not a
            theoretical one.
          </p>
          <p>
            The scene file and its WebAssembly helper come from the same vendor and inherit the same
            question. Nothing else in the tree depends on any of it: the mascot is decoration, and a
            2D fallback already renders wherever WebGPU is unavailable.
          </p>
          <p className="text-text-3">
            This is recorded here, in{' '}
            <span className="font-mono text-xs">THIRD-PARTY-NOTICES.md</span>, and on the Built with
            page, because a licence audit should find it in the first place it looks rather than the
            third.
          </p>
        </div>
      </Panel>

      {/* --------------------------------------------------------- disclaimer */}
      <Panel>
        <PanelTitle hint="the part that is not boilerplate">Disclaimers</PanelTitle>
        <div className="space-y-2.5 text-sm text-text-2">
          <p>
            <span className="text-text-1">No warranty.</span> jojo is provided “as is”, without
            warranty of any kind, express or implied. It keeps the only copy of your records on your
            own device. Take backups — Settings has the button, and it is there because nobody else
            is holding a copy for you.
          </p>
          <p>
            <span className="text-text-1">Not legal advice.</span> This page is a map of where the
            obligations sit, written by reading the licences it quotes. It is not advice, it may
            fall out of date the moment a vendor rewrites their terms, and the agreement you are
            bound by is the one you accepted — not this summary of it.
          </p>
          <p>
            <span className="text-text-1">No affiliation.</span> jojo is an independent project. It
            is not endorsed by, sponsored by or affiliated with NVIDIA, Microsoft, Anthropic,
            OpenAI, Groq, OpenRouter or Spline. Those names appear here because jojo can talk to
            their services or is built on their work, and every trademark belongs to its owner.
          </p>
          <p>
            <span className="text-text-1">Your data is yours, and so is the responsibility.</span>{' '}
            You decide whether anything leaves this device, by choosing a provider. If you send
            somebody else’s personal details — a referee’s email, a hiring manager’s name — to a
            third party, that is your call to make and, under most data-protection law, yours to
            answer for. jojo’s job is to make sure you know when it is happening.
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelTitle hint="the whole of it">The MIT licence, in full</PanelTitle>
        <p className="mb-2 text-sm text-text-2">MIT License · Copyright (c) 2026 Shaswata Mitra</p>
        <blockquote className="border-l-2 border-hairline pl-3 text-xs whitespace-pre-line text-text-3">
          {MIT_TEXT}
        </blockquote>
      </Panel>

      <GuideContents />
    </>
  )
}

/** One service, its standing, and what that standing costs you. */
function Term({ title, chip, body }: { title: string; chip: ReactNode; body: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-text-1">{title}</span>
        {chip}
      </p>
      <div className="mt-1.5 text-sm text-text-2">{body}</div>
    </div>
  )
}
