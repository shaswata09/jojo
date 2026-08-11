import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowUp, Quote, TriangleAlert } from 'lucide-react'
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
import { useVault } from '@/kg/react/use-vault'
import { useTitle, vaultPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'

/**
 * A worked example, and the prompt that produces it.
 *
 * Every reply on this page comes from this list. Nothing is generated, nothing
 * is fetched, and no reply is ever shown without the badge saying so — see
 * `Reply` below, where the badge is part of the component rather than something
 * a call site can forget.
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
  /** Assistant messages only — which script wrote it, and so how to file it. */
  scriptId?: string
}

/** How long the copied confirmation stays up, as in the Vault's snippets tool. */
const COPIED_MS = 1600

export function Assistant() {
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

  const send = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    const script = scriptFor(clean)
    const at = nextId.current
    nextId.current += 2

    // Both messages in one write, and with no delay: a thinking pause would be
    // theatre, and the reply was chosen before the question finished rendering.
    setMessages((prev) => [
      ...prev,
      { id: `m${at}`, role: 'you', text: clean },
      { id: `m${at + 1}`, role: 'assistant', text: script.reply, scriptId: script.id },
    ])
    setPrompt('')
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
        subtitle="Worked examples now. Connect a local model and it drafts from your own records."
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
            description="Pick one of the prompts below, or type anything. The replies are written examples — useful to work from, and never presented as a model's answer."
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
                    {/* Not optional, and not a call site's decision — every
                        assistant message renders through this branch. */}
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
              <Button variant="ghost" size="sm" onClick={() => send(s.action)}>
                {s.action}
              </Button>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-sm text-text-2">
          With a model connected each of these reads your profile and documents as context. Because
          inference would be local, your CV and your notes are never uploaded anywhere.
        </p>
      </Panel>
    </>
  )
}
