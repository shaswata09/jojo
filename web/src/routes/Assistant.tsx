import { ThreadBar } from '@/components/assistant/ThreadBar'
import { ThreadList } from '@/components/assistant/ThreadList'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { Chip } from '@/components/common/Chip'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelScroll } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { fromReactKey, shouldSend } from '@/lib/composer-keys'
import { Label } from '@/components/ui/label'
import type { SnippetTag } from '@/data/vault'
import { useTitle, vaultPath } from '@/lib/links'
import { isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { useToast } from '@/lib/toast-context'
import { useFillViewport } from '@/lib/use-fill-viewport'
import { atBottom } from '@/lib/scroll-stick'
import { CATALOG } from '@jojo/service/agent/catalog'
import type { NodeId } from '@jojo/service/core/model'
import { report } from '@/lib/analytics'
import { useConversation } from '@/lib/use-conversation'
import { Composer } from '@/components/assistant/Composer'
import { Transcript } from '@/components/assistant/Transcript'
import { useApplications } from '@jojo/service/react/use-applications'
import { useThreads } from '@jojo/service/react/use-threads'
import { useVault } from '@jojo/service/react/use-vault'
import type { LucideIcon } from 'lucide-react'
import { ArrowUp, Quote, TriangleAlert } from 'lucide-react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

/**
 * A worked example, and the prompt that produces it.
 *
 * These are what the page answers with when NO model is connected, which was
 * every reply until Settings learned to reach one. They are still the whole
 * behaviour of an unconfigured install, and they still carry the badge saying
 * so — attached to the message's own `scriptId` rather than to the branch that
 * rendered it, so a canned reply cannot lose its badge by being drawn somewhere
 * new. A real reply from a real model carries no badge, because it is not an
 * example.
 */
type Script = {
  id: string
  /** Doubles as the quick-action label and the message it sends. */
  action: string
  /** Words in a typed message that pick this script over the fallback. */
  cues: string[]
  /** Title and tag a snippet made from the reply is filed under. */
  title: string
  tag: SnippetTag
  reply: string
}

const SCRIPTS: Script[] = [
  {
    id: 'cover-letter',
    action: 'Draft a cover letter',
    cues: ['cover letter', 'letter of application', 'motivation'],
    title: 'Cover letter — structure',
    tag: 'Cover letter',
    reply:
      'Here is the shape I would use for [DEPARTMENT]:\n\n' +
      'Paragraph 1 — what you work on, in one sentence a committee member outside your area can follow.\n' +
      'Paragraph 2 — the two results that make the case, each given with its consequence rather than its method.\n' +
      'Paragraph 3 — why this department: the group you would overlap with, and the course you would teach.\n' +
      'Paragraph 4 — availability, and what the first three years would look like.\n\n' +
      'Keep it to one page. The committee reads forty of these in an evening.',
  },
  {
    id: 'tailor-cv',
    action: 'Tailor my CV to a posting',
    cues: ['cv', 'resume', 'tailor'],
    title: 'Tailoring a CV — three passes',
    tag: 'Application form',
    reply:
      'Three passes, in this order:\n\n' +
      '1. Cut what the ad does not ask for. A CV tailored to everything is tailored to nothing.\n' +
      '2. Move the section the ad leads with to the top of page one — a teaching-heavy ad wants teaching above publications.\n' +
      "3. Rewrite the headline in the ad's own words, without overstating the scope of the work.\n\n" +
      'What survives untouched: publications, references, dates. Those are the parts a committee checks.',
  },
  {
    id: 'parse-posting',
    action: 'Parse a job posting',
    cues: ['posting', 'parse', 'job ad', 'advert'],
    title: 'What to pull out of a posting',
    tag: 'Application form',
    reply:
      'From an ad I would pull out: employer, role, deadline, the documents required, the named contact, ' +
      'and anything phrased as a hard requirement rather than a preference.\n\n' +
      'The last one is where applications are lost — "must hold the degree by the start date" is a filter, ' +
      '"experience with large-scale systems desirable" is not.\n\n' +
      'Job scout already does the cheap half of this without a model: save the URL there and it keeps the link ' +
      'and guesses the employer from it.',
  },
  {
    id: 'follow-up',
    action: 'Draft a follow-up email',
    cues: ['follow up', 'follow-up', 'chase', 'nudge', 'email'],
    title: 'Follow-up after no response',
    tag: 'Email',
    reply:
      'Subject: Following up — [ROLE], [DEPARTMENT]\n\n' +
      'Dear [NAME],\n\n' +
      'I applied for [ROLE] on [DATE] and wanted to check the committee has everything it needs from me. ' +
      'I am happy to send the outstanding reference letter directly if that is easier.\n\n' +
      'I remain very interested in the position, and I am glad to answer anything by email.\n\n' +
      'With thanks,\n[YOUR NAME]',
  },
  {
    id: 'interview',
    action: 'Prepare me for an interview',
    cues: ['interview', 'job talk', 'chalk talk', 'campus visit'],
    title: 'Interview — six questions to have answered',
    tag: 'Application form',
    reply:
      'Six questions worth having an answer to before the day:\n\n' +
      '— What is the work about, in ninety seconds, to someone outside your area?\n' +
      '— What would your first grant be, and to which agency?\n' +
      '— Which two courses could you teach next semester at no notice?\n' +
      '— Who here would you collaborate with, and on what?\n' +
      '— What is the weakness in your own result?\n' +
      '— What do you need in year one to do the work?\n\n' +
      'Write the answers out longhand. The rehearsal is the point, not the notes.',
  },
]

/**
 * What comes back when nothing in the message matches a script.
 *
 * It says what it is rather than improvising, because the alternative — a
 * plausible-sounding paragraph about whatever was typed — is the exact thing a
 * page with no model behind it must not do.
 */
const FALLBACK: Script = {
  id: 'fallback',
  action: '',
  cues: [],
  title: 'Assistant — example response',
  tag: 'Application form',
  reply:
    'No model is connected, so this is a canned answer rather than a reply to what you typed.\n\n' +
    'With one connected, this page would read your profile, the documents in your Vault and the application ' +
    'you name, then draft against them on your own machine. Point jojo at a local OpenAI-compatible server ' +
    'in Settings — vLLM, Ollama or LM Studio.\n\n' +
    'Clear the conversation to see the worked examples again.',
}

/** First script with a cue in the message. Order in SCRIPTS breaks ties. */
function scriptFor(text: string): Script {
  const haystack = text.toLowerCase()
  return SCRIPTS.find((s) => s.cues.some((cue) => haystack.includes(cue))) ?? FALLBACK
}

type Message = {
  id: string
  role: 'you' | 'assistant'
  text: string
  /**
   * Assistant messages only — which script wrote it, and so how to file it.
   * Absent on a reply that came from a model, which is also what the badge
   * keys off: present means example, absent means answer.
   */
  scriptId?: string
  /** Set when a real request failed, so the row can say what went wrong. */
  failed?: boolean
}

/** How long the copied confirmation stays up, as in the Vault's snippets tool. */
const COPIED_MS = 1600

export function Assistant() {
  useTitle('Assistant')
  const { settings } = useModelSettings()
  // The split is at the top because the two modes share almost nothing below it:
  // one has a transcript of messages and the other a trace of tool calls, and a
  // single component holding both was a component with two of every state.
  return isConfigured(settings) ? <AgentPanel /> : <ScriptedPanel />
}

/* ---------------------------------- agent --------------------------------- */

/**
 * The assistant with a model behind it, acting on the records.
 *
 * The page is a trace, not a chat. What the model SAID is one entry among many;
 * what it DID is the rest, and those are the entries a person came to read. That
 * ordering is `useAgent`'s flat entry list rendered straight through — nothing
 * here re-sorts or groups it, because an interleaving computed at render time is
 * one that can be computed wrongly.
 */
function AgentPanel() {
  const { settings } = useModelSettings()
  const { all: applications, byId } = useApplications()
  const { threads, rename, file, remove, setApproval } = useThreads()
  const { toast } = useToast()

  /**
   * Whether the newest turn should be brought into view, or the reader left
   * where they put themselves.
   *
   * It used to be unconditional, and `agent-runs.ts` rewrites the streaming
   * answer once per delta — so the box was slammed back to its end once per
   * token for the length of every reply, and scrolling up to re-read the tool
   * row that produced the sentence being written was impossible: the next
   * fragment took the view back within a frame. A trace nobody can look back
   * through is not the thing this page says it is.
   *
   * A ref rather than state: it changes on every scroll event and nothing
   * renders differently for it. `atBottom` and its slack are in
   * `lib/scroll-stick.ts`, where they can be run.
   */
  const stick = useRef(true)

  /*
   * Which conversation is open. State, and only state.
   *
   * There was a ref beside it, written on every open and read by nothing, under
   * a comment saying `onSettled` read it — "by the time a run settles the state
   * it captured may be a conversation ago". That was true of the version that
   * looked up "which is open now" at settle time, and it is the bug the
   * registry was built to remove: `onSettled` is handed the thread the run was
   * FOR (see `agent-runs.ts` `StartOptions.onSettled`). Leaving the ref in
   * place left an invitation to go back to reading it, which is exactly how one
   * conversation's answer lands in another.
   */
  const [activeId, setActiveId] = useState<NodeId | null>(null)
  const openThread = useCallback((id: NodeId | null) => {
    // Opening a conversation pins the transcript to its end. The scroller is
    // the same DOM node across a switch, so it keeps the offset it had in the
    // conversation being left — which in a new one is a position in the middle
    // of somebody else's answer. See `stick` above.
    stick.current = true
    setActiveId(id)
  }, [])
  /** `?thread=` — the chat dock's "open in the full page" names its conversation. */
  const [params] = useSearchParams()
  const asked = params.get('thread')

  /**
   * Reopen the most recent conversation on arrival, once.
   *
   * Without this a reload landed on a blank thread with the whole history one
   * click away, which reads as having lost it. `useThreads` sorts newest first
   * for exactly this — a list of conversations is read like an inbox, and the
   * one you were just in is the one you want back.
   *
   * Once, and guarded by a ref rather than by `activeId`: pressing New sets the
   * pointer back to null on purpose, and an effect keyed on that would drag the
   * user straight back into the conversation they just left.
   */
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || threads.length === 0) return
    opened.current = true
    const named = asked === null ? undefined : threads.find((t) => t.id === asked)
    openThread(named?.id ?? threads[0]?.id ?? null)
  }, [threads, asked, openThread])
  const [prompt, setPrompt] = useState('')

  /*
   * The approval question is NOT held here any more.
   *
   * It used to be component state resolved by buttons inside the trace below,
   * which meant the question existed only while this page was open — walk away
   * mid-run and the loop parked on `await approve(...)` with nothing able to
   * resolve it, forever, and the exchange was never saved. The registry keeps it
   * on the run and `ApprovalHost` draws it wherever the person is, including
   * here. One control, one place, on every page.
   */

  /*
   * The conversation's wiring — the per-run abort, the chooser and summariser,
   * the reader, which conversation a settled run saves into, when a first
   * question mints the conversation, and what the conversation is ABOUT — is
   * shared with the chat dock's windows, in `lib/use-conversation.ts`. Two
   * surfaces showing the same conversation must not run it differently.
   */
  const { entries, busy, send, stop, clear } = useConversation({
    threadId: activeId,
    onStarted: openThread,
  })

  /**
   * Keeps the newest turn in view.
   *
   * Never needed before, because the document scrolled and the page simply
   * grew. The transcript is its own scroll region now, so without this a new
   * answer — and the "Thinking" line while it works — lands below the fold of a
   * box the reader is looking straight at.
   */
  /*
   * A higher give-up threshold than the default, because this panel is not just
   * a scroller.
   *
   * The cap applies to the PANEL; the transcript gets whatever the thread bar
   * above it and the composer below it leave behind, and those two want a
   * little over 300px together. So capping into anything less than about 420px
   * buys a page that does not scroll at the price of a conversation you cannot
   * read — which is the wrong trade. Below that this does not cap at all: the
   * panel takes its full height and the page scrolls, the way a narrow screen
   * normally does.
   */
  /*
   * Search lives here rather than in `ThreadList`, because two things need it:
   * the list, to decide which conversations to show, and the transcript, to
   * mark the same words inside the one you then open. Finding the conversation
   * and then hunting the sentence by eye is half a feature.
   *
   * Not in the URL, deliberately, unlike the Vault's tool and focus. Those name
   * a place worth linking to; this is a find-in-page, and a query string that
   * survives a reload would re-filter a list the reader had finished with.
   */
  const [search, setSearch] = useState('')

  const fill = useFillViewport(20, 420)
  const transcriptRef = useRef<HTMLDivElement>(null)

  // Where the reader is, recorded as they move rather than measured when the
  // answer arrives — by then the effect has already had to decide.
  const onTranscriptScroll = () => {
    const box = transcriptRef.current
    if (box) stick.current = atBottom(box.scrollTop, box.scrollHeight, box.clientHeight)
  }

  useEffect(() => {
    const box = transcriptRef.current
    if (box && stick.current) box.scrollTop = box.scrollHeight
  }, [entries, busy])

  /**
   * Asking something re-pins the transcript, wherever the reader had scrolled to.
   *
   * The one moment the answer is definitely what they want to see. Without this
   * a person who had scrolled up to find something to quote would ask their
   * question and watch nothing happen, a screen above the reply.
   */
  const ask = (text: string) => {
    stick.current = true
    void send(text)
  }

  const onSend = (clean: string) => {
    /*
     * That a question was asked, and NOTHING about the question.
     *
     * `tools_available` and `has_model` are what actually explain the assistant's
     * numbers: a person with no model connected gets a different product, and
     * counting their questions alongside everybody else's makes both figures
     * mean nothing. The text itself is never reported and there is no parameter
     * it could travel in — see `core/analytics.ts`.
     */
    report('assistant_asked', {
      tools_available: CATALOG.length,
      has_model: settings.model.trim().length > 0,
    })
    ask(clean)
  }

  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Connected to your model, and able to act on your records. Everything it does is listed as it happens."
        actions={
          entries.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                clear()
                openThread(null)
              }}
            >
              Clear
            </Button>
          ) : null
        }
      />

      <p role="status" className="rounded-lg border border-hairline px-4 py-3 text-sm text-text-2">
        Answers come from <span className="font-mono text-text-1">{settings.model}</span> at{' '}
        <span className="font-mono text-text-1">{settings.endpoint}</span>, which can call{' '}
        <Link to="/guide" className="underline underline-offset-2">
          {CATALOG.length} tools
        </Link>{' '}
        on this device. Nothing is sent anywhere else.
      </p>

      {/* `min-h-0 flex-1` is the seam AppShell documents: it hands a page the
          height left over, so the conversation can own it instead of the card
          sitting in the top third of an empty screen. */}
      <div className="grid min-h-0 min-w-0 flex-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <ThreadList
          threads={threads}
          activeId={activeId}
          byId={byId}
          query={search}
          onQuery={setSearch}
          onOpen={openThread}
          onNew={() => {
            // No `clear()`. It forgets the run for the conversation being left,
            // and leaving a conversation is now exactly when it should keep
            // going. Opening nothing is the whole of "new".
            openThread(null)
          }}
        />

        {/* Capped by measurement, not by `flex-1`.
            The shell is `min-h-dvh` — a minimum, not a definite height — so a
            flex child fills the space when the conversation is short and simply
            grows when it is long, scrolling the page instead of itself. That is
            the exact failure `useFillViewport` was written for, and the
            applications table is the precedent. */}
        <Panel
          ref={fill.ref}
          style={{ maxHeight: fill.maxHeight }}
          className="flex min-h-0 min-w-0 flex-col"
        >
          <ThreadBar
            threads={threads}
            activeId={activeId}
            applications={applications}
            busy={busy}
            onSetApproval={(id, mode) => {
              setApproval(id, mode)
            }}
            onRename={(id, title) => {
              rename(id, title)
            }}
            onFile={(id, applicationId) => {
              const result = file(id, applicationId)
              if (result.ok) {
                toast({
                  title: result.announcement.title,
                  ...(result.announcement.description === undefined
                    ? {}
                    : { description: result.announcement.description }),
                  ...(result.undo ? { action: { label: 'Undo', onClick: result.undo } } : {}),
                })
              }
            }}
            onDelete={(id) => {
              const result = remove(id)
              if (!result.ok) return
              // The open conversation just stopped existing; showing its turns
              // under a title that is gone reads as a failed delete.
              clear()
              openThread(null)
              toast({
                title: 'Conversation deleted',
                tone: 'danger',
                ...(result.undo ? { action: { label: 'Undo', onClick: result.undo } } : {}),
              })
            }}
          />

          <div className="my-3 border-t border-hairline" />

          {/* The transcript owns the leftover height and scrolls inside it, so the
            composer stays put instead of being pushed down the page by a long
            conversation. */}
          {/* `bleed="sides"` because the composer sits below this. The default
              bottom bleed is a negative margin, which pulled the composer up
              into this scroller's padding — turns then painted underneath the
              input. `PanelScroll` already carries `min-h-0 flex-1`, so the
              transcript shrinks to fit whatever the composer leaves. */}
          <PanelScroll axis="y" bleed="sides" ref={transcriptRef} onScroll={onTranscriptScroll}>
            {entries.length === 0 ? (
              <EmptyState
                icon={RobotIcon as unknown as LucideIcon}
                title="Nothing asked yet"
                description="Ask it to find something, add an application, or move one along. Each tool it runs appears below as it happens, with what it sent and what came back."
              />
            ) : (
              <Transcript entries={entries} busy={busy} model={settings.model} query={search} />
            )}
          </PanelScroll>

          {/* Openers, and ONLY while the thread is empty.
            They are what a person reads when they do not know what to ask —
            which stops being true the moment they have asked something. Left in
            permanently they sat between the transcript and the box, so every
            turn pushed a row of unrelated prompts up against the last reply and
            squeezed the conversation the person actually came to read. An
            opener has no job in a conversation already under way. */}
          {entries.length === 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {AGENT_PROMPTS.map((p) => (
                <li key={p}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      ask(p)
                    }}
                  >
                    {p}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-2">
            <Composer
              id="assistant-prompt"
              label="Ask the assistant"
              value={prompt}
              onChange={setPrompt}
              onSend={onSend}
              busy={busy}
              onStop={stop}
              placeholder="Find my UT Austin application, or add one, or move it to interview…"
            />
          </div>
        </Panel>
      </div>
    </>
  )
}

/**
 * Openers that exercise the surface rather than showing off.
 *
 * Two reads and two writes, and each one is a task with an id in the middle of
 * it — which is the shape that actually tests whether a small model can chain
 * `memory.search` into a write instead of inventing an id.
 */
const AGENT_PROMPTS = [
  'What am I waiting on?',
  'Add an application: ML engineer at Stripe, submitted',
  'Which applications have no deadline?',
  'Flag my UT Austin application',
]

/* --------------------------------- scripted -------------------------------- */

/**
 * The assistant with no model behind it.
 *
 * Everything here is a worked example and says so. This was the whole page
 * before Settings could reach a model, and it is unchanged in behaviour — what
 * changed is that it no longer has to ASK whether one is connected, because
 * `Assistant` above answered that before rendering it. The `connected` branches
 * that used to be threaded through every string are gone with it.
 */
function ScriptedPanel() {
  useTitle('Assistant')
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const nextId = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const { addSnippet } = useVault()
  const { toast } = useToast()
  const navigate = useNavigate()

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  /**
   * The unconnected path, and the only one this page had for its whole life.
   *
   * No model, no request, no delay: the reply was chosen before the question
   * finished rendering, and a thinking pause would be theatre. Every message it
   * produces carries `scriptId`, which is what puts the badge on it — see the
   * row below, where the badge is keyed to the message rather than to the branch
   * that drew it.
   */
  const send = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    const script = scriptFor(clean)
    const at = nextId.current
    nextId.current += 2
    setPrompt('')
    setMessages((prev) => [
      ...prev,
      { id: `m${at}`, role: 'you', text: clean },
      { id: `m${at + 1}`, role: 'assistant', text: script.reply, scriptId: script.id },
    ])
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(prompt)
  }

  /*
   * Enter sends; Shift+Enter is left to the textarea, which puts in the newline
   * itself. `shouldSend` also refuses an Enter that an input method is using to
   * pick a candidate — see `lib/composer-keys.ts`, where the rule is tested.
   */
  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSend(fromReactKey(event))) return
    event.preventDefault()
    onSubmit(event)
  }

  const copy = async (id: string, text: string) => {
    clearTimeout(copyTimer.current)
    try {
      // Unavailable outside a secure context, and refused outright by some
      // browsers — hence the visible failure rather than a confirmation for
      // something that did not happen.
      await navigator.clipboard.writeText(text)
      setCopyFailed(false)
    } catch {
      setCopyFailed(true)
    }
    setCopiedId(id)
    copyTimer.current = setTimeout(() => setCopiedId(null), COPIED_MS)
  }

  const saveToSnippets = (message: Message) => {
    const script = SCRIPTS.find((s) => s.id === message.scriptId) ?? FALLBACK
    const snippet = addSnippet({ title: script.title, tag: script.tag, body: message.text })
    toast({
      title: 'Saved to snippets',
      description: `${snippet.title} · filed under ${snippet.tag}`,
      action: {
        label: 'Open vault',
        onClick: () => navigate(vaultPath({ tool: 'snippets' })),
      },
    })
  }

  /** A conversation of canned replies is the cheapest record in the app — an
   *  undo toast, no confirmation. */
  const clearConversation = () => {
    const previous = messages
    setMessages([])
    toast({
      title: 'Conversation cleared',
      description: `${previous.length} messages`,
      tone: 'danger',
      action: { label: 'Undo', onClick: () => setMessages(previous) },
    })
  }

  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Worked examples now. Connect a local model and it both drafts from your own records and acts on them."
        actions={
          messages.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearConversation}>
              Clear conversation
            </Button>
          ) : null
        }
      />

      {/* Stated once, at the top, in the same words the Job scout uses for the
          same fact. The per-reply badge below repeats it because a reply that
          scrolled away from this banner would otherwise read as a real answer.

          Connected, it says the opposite thing and is not a warning: which model
          and at what address, because "where did that answer come from" is the
          question a local-first app has to be able to answer on the page rather
          than in Settings. */}
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
        <p>
          No model is connected, so every reply below is a worked example rather than an answer.
          Point jojo at a local OpenAI-compatible server — vLLM, Ollama or LM Studio — in{' '}
          <Link to="/settings" className="underline underline-offset-2">
            Settings
          </Link>
          .
        </p>
      </div>

      <Panel className="min-w-0">
        {messages.length === 0 ? (
          <EmptyState
            // EmptyState takes a Lucide component; the brand mark is a plain
            // SVG with the same three props, so the cast is safe and is how the
            // rest of the app has always passed it.
            icon={RobotIcon as unknown as LucideIcon}
            title="Nothing asked yet"
            description="Pick one of the prompts below, or type anything. The replies are written examples — useful to work from, and never presented as a model’s answer."
          />
        ) : (
          // A log, so both halves are announced in the order they arrive.
          <ul aria-live="polite" className="space-y-3">
            {messages.map((m) =>
              m.role === 'you' ? (
                <li key={m.id} className="flex justify-end">
                  <p className="well max-w-[36rem] rounded-lg px-3 py-2 text-sm wrap-anywhere whitespace-pre-line text-text-1">
                    {m.text}
                  </p>
                </li>
              ) : (
                <li key={m.id} className="rounded-lg border border-hairline p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <RobotIcon className="size-4 shrink-0" aria-hidden />
                    {/* Keyed to the message and not to the branch, so a canned
                        reply cannot lose its badge by being drawn somewhere new.
                        A model's answer wears nothing, which is what makes the
                        badge mean anything at all. */}
                    <Chip tone="amber">Example response · no model connected</Chip>
                  </div>

                  {/* whitespace-pre-line so the drafts keep their paragraphs. */}
                  <p className="text-sm wrap-anywhere whitespace-pre-line text-text-1">{m.text}</p>

                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => copy(m.id, m.text)}>
                      <CopyFeedback copied={copiedId === m.id} failed={copyFailed} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => saveToSnippets(m)}>
                      <Quote className="size-3.5" strokeWidth={1.8} aria-hidden />
                      Save to snippets
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        {/* Announced rather than only shown: the confirmation appears on a
            button the user has just left, and a swapped icon is easy to miss. */}
        <p aria-live="polite" className="sr-only">
          {copiedId ? (copyFailed ? 'Copy was blocked by the browser' : 'Reply copied') : ''}
        </p>

        {/* Empty thread only, exactly as the connected panel does it — the two
            must not visibly diverge for the person who has not set a model up
            yet, and that includes when the openers disappear. */}
        {messages.length === 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {SCRIPTS.map((s) => (
              <li key={s.id}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    send(s.action)
                  }}
                >
                  {s.action}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <form onSubmit={onSubmit} className="mt-2 flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="assistant-prompt" className="sr-only">
              Ask the assistant
            </Label>
            <Textarea
              id="assistant-prompt"
              value={prompt}
              rows={2}
              // Fixed, for the reasons set out on the connected composer above.
              className="field-sizing-fixed h-16 resize-none overflow-y-auto"
              autoComplete="off"
              placeholder="Ask about a cover letter, a follow-up email, an interview…"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onComposerKey}
            />
          </div>
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            disabled={!prompt.trim()}
            title={prompt.trim() ? 'Send' : 'Type a message first'}
          >
            <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
          </Button>
        </form>
      </Panel>

      <p className="text-sm text-text-2">
        With a model connected each of these reads your profile and documents as context. Because
        inference is local, your CV and your notes are never uploaded anywhere.
      </p>
    </>
  )
}
