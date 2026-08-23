import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowUp, Quote, TriangleAlert } from 'lucide-react'
import { agentTurn, isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { useAgent } from '@jojo/service/react/use-agent'
import type { AgentStep } from '@jojo/service/agent/loop'
import { CATALOG } from '@jojo/service/agent/catalog'
import { StepRow, Thinking } from '@/components/assistant/AgentTrace'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import type { LucideIcon } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SnippetTag } from '@/data/vault'
import { useVault } from '@jojo/service/react/use-vault'
import { useTitle, vaultPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'

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
    'The five prompts above each have a worked example you can use in the meantime.',
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
  const { addSnippet } = useVault()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  /**
   * A destructive call, waiting on a person.
   *
   * The promise is held open in state until a button is pressed. That is the
   * whole approval mechanism: `runAgent` awaits `approve`, so the loop is
   * genuinely stopped — not racing a dialog — and nothing is written while the
   * question is on screen.
   */
  const [ask, setAsk] = useState<{ step: AgentStep; decide: (ok: boolean) => void } | null>(null)
  const approve = useCallback(
    (step: AgentStep) =>
      new Promise<boolean>((resolve) => {
        setAsk({
          step,
          decide: (ok) => {
            setAsk(null)
            resolve(ok)
          },
        })
      }),
    [],
  )

  const llm = useCallback(
    (messages: Parameters<typeof agentTurn>[1], tools: Parameters<typeof agentTurn>[2]) =>
      agentTurn(settings, messages, tools),
    [settings],
  )

  const { entries, busy, send, stop, clear } = useAgent({ llm, approve })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const clean = prompt.trim()
    if (!clean || busy) return
    setPrompt('')
    void send(clean)
  }

  const copy = async (id: string, text: string) => {
    clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(text)
      setCopyFailed(false)
    } catch {
      setCopyFailed(true)
    }
    setCopiedId(id)
    copyTimer.current = setTimeout(() => setCopiedId(null), COPIED_MS)
  }

  /**
   * Undoing one step of the agent's work.
   *
   * Goes through the same `undo` the toast on a button press would have called,
   * because it IS that undo — `runtime.run` handed it back and the step kept it.
   * The row stays on screen afterwards: the trace is a record of what happened,
   * and a step vanishing when it is reverted would make the record wrong.
   */
  const undoStep = (step: AgentStep) => {
    step.undo?.()
    toast({
      title: 'Undone',
      description: step.announcement?.title ?? step.title,
      tone: 'danger',
    })
  }

  const saveAnswer = (text: string, asked: string) => {
    const snippet = addSnippet({
      // Titled with the question, because an agent answer has no script behind
      // it to take a title from and "Assistant reply 3" helps nobody find it.
      title: asked.length > 60 ? `${asked.slice(0, 57)}…` : asked,
      tag: 'Email',
      body: text,
    })
    toast({
      title: 'Saved to snippets',
      description: `${snippet.title} · filed under ${snippet.tag}`,
      action: { label: 'Open vault', onClick: () => navigate(vaultPath({ tool: 'snippets' })) },
    })
  }

  /** The question that produced a given answer, for the snippet's title. */
  const askedBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      const e = entries[i]
      if (e?.kind === 'you') return e.text
    }
    return 'Assistant'
  }

  return (
    <>
      <PageHeader
        title="Assistant"
        subtitle="Connected to your model, and able to act on your records. Everything it does is listed as it happens."
        actions={
          entries.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={clear} disabled={busy}>
              Clear conversation
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
        on this device. Nothing is sent anywhere else, and every change it makes can be undone.
      </p>

      <Panel className="min-w-0">
        {entries.length === 0 ? (
          <EmptyState
            icon={RobotIcon as unknown as LucideIcon}
            title="Nothing asked yet"
            description="Ask it to find something, add an application, or move one along. Each tool it runs appears below as it happens, with what it sent and what came back."
          />
        ) : (
          <ul aria-live="polite" className="space-y-3">
            {entries.map((entry, index) => {
              if (entry.kind === 'you') {
                return (
                  <li key={entry.id} className="flex justify-end">
                    <p className="well max-w-[36rem] rounded-lg px-3 py-2 text-sm text-text-1">
                      {entry.text}
                    </p>
                  </li>
                )
              }
              if (entry.kind === 'step') {
                return (
                  <StepRow
                    key={entry.id}
                    step={entry.step}
                    onUndo={undoStep}
                    {...(ask?.step.id === entry.step.id
                      ? {
                          pending: {
                            allow: () => ask.decide(true),
                            decline: () => ask.decide(false),
                          },
                        }
                      : {})}
                  />
                )
              }
              if (entry.kind === 'note') {
                // Narration while it is still working. Quieter than an answer on
                // purpose: it is not the reply, and styling it like one makes a
                // run look finished when it is not.
                return (
                  <li key={entry.id} className="px-1 text-sm text-text-3 italic">
                    {entry.text}
                  </li>
                )
              }
              if (entry.kind === 'error') {
                return (
                  <li
                    key={entry.id}
                    className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
                  >
                    {entry.text}
                  </li>
                )
              }
              return (
                <li key={entry.id} className="rounded-lg border border-hairline p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <RobotIcon className="size-4 shrink-0" aria-hidden />
                  </div>
                  <p className="text-sm whitespace-pre-line text-text-1">{entry.text}</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => copy(entry.id, entry.text)}>
                      <CopyFeedback copied={copiedId === entry.id} failed={copyFailed} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        saveAnswer(entry.text, askedBefore(index))
                      }}
                    >
                      <Quote className="size-3.5" strokeWidth={1.8} aria-hidden />
                      Save to snippets
                    </Button>
                  </div>
                </li>
              )
            })}
            {/* Only while nothing else is moving. A spinner under a step that is
                already spinning says the same thing twice. */}
            {busy && entries.at(-1)?.kind !== 'step' ? <Thinking model={settings.model} /> : null}
          </ul>
        )}

        <p aria-live="polite" className="sr-only">
          {copiedId ? (copyFailed ? 'Copy was blocked by the browser' : 'Reply copied') : ''}
        </p>

        <form onSubmit={onSubmit} className="mt-4 flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="assistant-prompt" className="sr-only">
              Ask the assistant
            </Label>
            <Input
              id="assistant-prompt"
              value={prompt}
              autoComplete="off"
              disabled={busy}
              placeholder="Find my UT Austin application, or add one, or move it to interview…"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>
          {busy ? (
            // Stop rather than a disabled send: a run that has gone wrong is
            // exactly when a person most needs a control, and the loop checks
            // the flag between every round.
            <Button type="button" variant="outline" onClick={stop} title="Stop the agent">
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={!prompt.trim()}
              title={prompt.trim() ? 'Send' : 'Type a message first'}
            >
              <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
            </Button>
          )}
        </form>
      </Panel>

      <Panel className="min-w-0">
        <PanelTitle hint="it will use whatever tools these need">Try one of these</PanelTitle>
        <ul className="flex flex-wrap gap-2">
          {AGENT_PROMPTS.map((p) => (
            <li key={p}>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void send(p)
                }}
              >
                {p}
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-text-2">
          It reads before it writes, asks before it deletes, and every change it makes goes through
          the same undo a button press does.
        </p>
      </Panel>
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
      {/* Stated once, at the top, in the same words the Job scout uses for the
          same fact. The per-reply badge below repeats it because a reply that
          scrolled away from this banner would otherwise read as a real answer. */}
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
                  <p className="well max-w-[36rem] rounded-lg px-3 py-2 text-sm text-text-1">
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
                  <p className="text-sm whitespace-pre-line text-text-1">{m.text}</p>

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

        <form onSubmit={onSubmit} className="mt-4 flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="assistant-prompt" className="sr-only">
              Ask the assistant
            </Label>
            <Input
              id="assistant-prompt"
              value={prompt}
              autoComplete="off"
              placeholder="Ask about a cover letter, a follow-up email, an interview…"
              onChange={(event) => setPrompt(event.target.value)}
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

      <Panel className="min-w-0">
        <PanelTitle hint="each one answers with an example">Try one of these</PanelTitle>
        <ul className="flex flex-wrap gap-2">
          {SCRIPTS.map((s) => (
            <li key={s.id}>
              <Button
                variant="ghost"
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

        <p className="mt-4 text-sm text-text-2">
          With a model connected each of these reads your profile and documents as context. Because
          inference is local, your CV and your notes are never uploaded anywhere.
        </p>
      </Panel>
    </>
  )
}
