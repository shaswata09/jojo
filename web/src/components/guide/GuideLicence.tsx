import type { ReactNode } from 'react'
import { Chip } from '@/components/common/Chip'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { GuideContents } from '@/components/guide/GuideNav'
import { APACHE_CLAUSES } from '@/components/guide/credits'
import { STATUS_HEADLINE, STATUS_POINTS, STATUS_SUMMARY } from '@jojo/service/core/status'
import { useTitle } from '@/lib/links'
import { publicUrl } from '@/lib/public-url'
import { PRIVACY_PAGE } from '@jojo/service/core/privacy'
import { EnglishOnlyNotice } from '@/components/guide/EnglishOnlyNotice'

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
 * where the answer is uncomfortable it is written down anyway. A licence page
 * that omitted an awkward term would be worse than no page, because a reader
 * has no way to tell a careful list from a comfortable one. (It used to name
 * two. NVIDIA's free API was licensed for evaluation and not for production,
 * which is what people would have used it for, so the provider was removed
 * rather than explained (Q345). And the 3D mascot's
 * third-party runtime shipped in the bundle with no licence grant at all. That
 * gap was closed by replacing the mascot — first with a robot modelled in
 * code, then with a CC BY model credited on the Built with page — rather than
 * by guessing at the terms.)
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
        subtitle="jojo is a research preview under Apache-2.0. The services you can point it at are not jojo's, and they come with their own terms."
      />
      <EnglishOnlyNotice />

      {/* ------------------------------------------------------------ status
          FIRST on the page, above the licence itself, because it is the thing
          that changes what everything below means. Somebody reading "free for
          any use, including commercial" without knowing this is research code
          has been told the truth and still misled. */}
      <Panel className="border-warning-border bg-warning-soft">
        <PanelTitle hint="read this before the rest">{STATUS_HEADLINE}</PanelTitle>
        <p className="mb-3 text-sm text-text-2">{STATUS_SUMMARY}</p>
        <dl className="space-y-2.5 text-sm text-text-2">
          {STATUS_POINTS.map((point) => (
            <div key={point.label}>
              <dt className="inline text-text-1">{point.label}. </dt>
              <dd className="inline">{point.body}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {/* ------------------------------------------------------ jojo itself */}
      <Panel>
        <PanelTitle hint="Apache-2.0 · free for any use, including commercial">
          jojo’s own licence
        </PanelTitle>
        <div className="space-y-2.5 text-sm text-text-2">
          <p>
            <span className="text-text-1">
              jojo is open source under the Apache License 2.0, © 2026 Shaswata Mitra.
            </span>{' '}
            You may use it, copy it, change it, and ship it in something you sell. There is no fee,
            no account, no licence key and no per-seat anything. The full text is in{' '}
            <span className="font-mono text-xs">LICENSE</span> at the root of the repository; the
            clauses that decide what you may do are quoted at the foot of this page.
          </p>
          <p>
            What it asks in return is short. Keep the copyright and licence notice with any
            substantial copy you distribute, pass on the{' '}
            <span className="font-mono text-xs">NOTICE</span> file, mark any files you changed, and
            accept that it comes with <span className="text-text-1">no warranty of any kind</span> —
            see the disclaimer below, which is not boilerplate here.
          </p>
          <p>
            Apache-2.0 rather than MIT for one reason: <span className="text-text-1">patents</span>.
            Every contributor grants a patent licence along with their code, and loses it if they
            sue anyone over this project. MIT never mentions patents at all, which leaves open the
            case where somebody contributes a patented method and later sues the people using it — a
            copyright licence would not have stopped them. It covers contributors only: no licence
            can shield you from a third party who never touched this code.
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
          {/*
           * Neutral on purpose (2026-11-21). This used to say these were
           * "commercial terms, which generally do permit production use" —
           * a reading of four other companies' contracts, offered as
           * reassurance on the page where somebody decides whether to send
           * their records. Whether a personal job search fits terms written
           * for businesses and developers is not this project's to answer, so
           * the page says what is checkable (who bills, who routes, when
           * records go) and leaves the reading to the person, with the terms
           * linked from Settings where they choose.
           */}
          <Term
            title="Anthropic · OpenAI · OpenRouter · Groq"
            chip={<Chip tone="gray">Your key · your account</Chip>}
            body={
              <p>
                Hosted APIs, each under its vendor’s own terms. Anthropic and OpenAI bill your
                account; Groq and OpenRouter also have free tiers with limits. OpenRouter passes
                each request on to the company whose model you pick, so that company’s terms apply
                as well as OpenRouter’s. These terms are written for businesses and developers, and
                jojo does not tell you whether a personal job search fits them — read the one you
                choose and decide. They differ on whether prompts may be retained, whether they may
                be used for training, and what you may build. While one is selected it receives your
                records not only when you chat but in background work too: the duplicate check at
                Save, scout readings, fit readings, tailoring and compaction. jojo does not
                negotiate any of that on your behalf and cannot.
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
            title="Claude Code, or any MCP client"
            chip={<Chip tone="green">Your plan · nothing sent</Chip>}
            body={
              <p>
                With <span className="text-text-1">Connect from an MCP client</span> switched on in
                Settings, an assistant you run can use jojo’s tools. It runs on{' '}
                <span className="text-text-1">your</span> plan with{' '}
                <span className="text-text-1">your</span> login, under its vendor’s terms — jojo
                sees neither and sends nothing to Anthropic or anyone else. jojo does not offer a
                Claude login of its own, which Anthropic does not permit third-party apps to do;
                this is the reverse, and what MCP is for. The small program that carries the link,{' '}
                <span className="font-mono text-xs">jojo-bridge</span>, is jojo’s own and listens
                only on 127.0.0.1. “Claude” and “Claude Code” are Anthropic’s marks; naming a client
                jojo works with is not a claim of endorsement or affiliation.
              </p>
            }
          />

          <Term
            title="Ollama · vLLM · LM Studio · llama.cpp"
            chip={<Chip tone="green">Nothing leaves</Chip>}
            body={
              <p>
                A server you run, on your own machine or your own network. Nothing is sent anywhere
                else and no third-party terms come into it — the model weights you load have their
                own licences, which are between you and whoever published them. This is the
                configuration with the fewest strings attached, and it is why it is the default.
                Point one of these at an address somewhere else and your records go there instead;
                Settings says so when the address you type is not local.
              </p>
            }
          />
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
          {/* Extended 2026-11-21 past the model vendors: the app names job boards
              in its copy and reads some of them, and its demo data is made of
              real employers' names. Each is somebody's mark, and naming it is
              not a claim of any relationship. */}
          <p>
            <span className="text-text-1">No affiliation.</span> jojo is an independent project. It
            is not endorsed by, sponsored by or affiliated with Microsoft, Anthropic, OpenAI, Groq
            or OpenRouter. Nor is it endorsed by, sponsored by or affiliated with the job boards and
            hiring systems it names or can read — among them LinkedIn, Indeed, Glassdoor,
            ZipRecruiter, HigherEdJobs, the CRA job board (Computing Research Association),
            AcademicJobsOnline, AcademicCareers, Workday, Greenhouse, Lever, Ashby, iCIMS, Taleo and
            Interfolio — or with the employers named in its demo data: Google, Stripe, Databricks,
            Rice University, Baylor University, Southern Methodist University, Texas A&amp;M
            University, Texas Tech University, the University of Houston, the University of North
            Texas and The University of Texas at Austin. The demo records are invented and say
            nothing about how any of them hires. These names appear because jojo can talk to those
            services, can read their public pages when you point it at them, or uses them as sample
            data, and every trademark belongs to its owner.
          </p>
          <p>
            <span className="text-text-1">Your data is yours, and so is the responsibility.</span>{' '}
            You decide whether anything leaves this device, by choosing a provider. If you send
            somebody else’s personal details — a referee’s email, a hiring manager’s name — to a
            third party, that is your call to make and, under most data-protection law, yours to
            answer for. jojo’s job is to make sure you know when it is happening.
          </p>
          {/* The privacy notice, linked from the page about obligations because
              it is the other half of them: this page says what you take on,
              that one says what jojo's own hosted copy does with data. A plain
              link to the copy shipped with this build (`core/privacy.ts`), so a
              fork's notice is the fork's. */}
          <p>
            <span className="text-text-1">Privacy.</span> What stays on your device, what can leave
            it and when — the optional usage analytics and crash reports, a model provider you
            choose, the job boards your scout reads — and how to say no are set out in the{' '}
            <a
              href={publicUrl(PRIVACY_PAGE)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline decoration-1 underline-offset-4"
            >
              privacy notice
            </a>
            .
          </p>
        </div>
      </Panel>

      <Panel>
        <PanelTitle hint="quoted verbatim">The clauses that decide what you may do</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          Apache License 2.0 · Copyright 2026 Shaswata Mitra. These four are quoted word for word;
          what is left out is definitions, the boilerplate appendix, and the trademark clause, none
          of which change what you may do. The whole of it is in{' '}
          <span className="font-mono text-xs">LICENSE</span> at the root of the repository — which
          is where the licence itself says it must travel.
        </p>
        <div className="space-y-3">
          {APACHE_CLAUSES.map((clause) => (
            <div key={clause.heading}>
              <p className="text-xs font-medium text-text-2">{clause.heading}</p>
              <blockquote className="mt-1 border-s-2 border-hairline ps-3 text-xs wrap-anywhere text-text-3">
                {clause.text}
              </blockquote>
            </div>
          ))}
        </div>
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
