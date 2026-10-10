import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Briefcase, ChevronDown, ChevronUp, Loader2, Maximize2, X } from 'lucide-react'
import { displayName } from '@jojo/service/core/model'
import type { NodeId } from '@jojo/service/core/model'
import { CATALOG } from '@jojo/service/agent/catalog'
import { useThreads } from '@jojo/service/react/use-threads'
import { Composer } from '@/components/assistant/Composer'
import { Transcript } from '@/components/assistant/Transcript'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { Button } from '@/components/ui/button'
import { report } from '@/lib/analytics'
import { DOCK_ATTR, type DockWindow } from '@/lib/chat-dock'
import { assistantPath, settingsPath } from '@/lib/links'
import { atBottom } from '@/lib/scroll-stick'
import { useToast } from '@/lib/toast-context'
import { useConversation } from '@/lib/use-conversation'
import { cn } from '@/lib/utils'

/** Openers for a conversation about one application — the questions people ask beside a record. */
const ABOUT_PROMPTS = [
  'What is left to do for this application?',
  'Draft a follow-up email for this one',
  'Summarise this application',
]
/** And for a conversation about nothing in particular. */
const GENERAL_PROMPTS = ['What am I waiting on?', 'Which applications have no deadline?']

/**
 * One conversation in the chat dock — LinkedIn's message window, for jojo.
 *
 * A header that minimises it to a bar, and below it the same transcript and
 * composer the Assistant page draws (`Transcript`, `Composer`), run by the same
 * hook (`useConversation`), so a conversation behaves identically in both
 * places. What is particular to a window is small: it can be minimised, it
 * opens out to the full page, and a new one is ABOUT the record that was open
 * when it was started — shown as a chip that can be removed.
 */
export function ChatWindow({
  win,
  width,
  onAdopt,
  onToggle,
  onClose,
  onDetach,
  onBack,
  fullScreen = false,
}: {
  win: DockWindow
  width: number | undefined
  /** A first question minted the conversation. */
  onAdopt: (key: string, threadId: NodeId) => void
  onToggle: (key: string) => void
  onClose: (key: string) => void
  /** Remove a NEW conversation's subject before anything is asked. */
  onDetach: (key: string) => void
  /** Back to the list, when the dock shows one panel at a time. */
  onBack?: (() => void) | undefined
  fullScreen?: boolean
}) {
  const { file } = useThreads()
  const { toast } = useToast()
  const convo = useConversation({
    threadId: win.threadId as NodeId | null,
    applicationId: win.threadId === null ? win.applicationId : null,
    onStarted: (id) => onAdopt(win.key, id),
  })
  const { entries, busy, send, stop, thread, subject, configured, model } = convo

  const [prompt, setPrompt] = useState('')
  const title = thread?.title ?? 'New conversation'
  const open = fullScreen || !win.minimized

  /* Stick to the newest turn unless the reader scrolled up — the page's rule. */
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [entries, busy, open])

  /* A window opened out takes the caret, so typing can start at once. */
  const composerId = `dock-prompt-${win.key}`
  useEffect(() => {
    if (open) document.getElementById(composerId)?.focus()
  }, [open, composerId])

  const ask = (text: string) => {
    stick.current = true
    report('assistant_asked', {
      tools_available: CATALOG.length,
      has_model: model.trim().length > 0,
    })
    void send(text)
  }

  /** The subject chip's ✕: a draft just forgets it; a conversation is unfiled, with an undo. */
  const removeSubject = () => {
    if (win.threadId === null) {
      onDetach(win.key)
      return
    }
    const result = file(win.threadId as NodeId, null)
    if (result.ok) {
      toast({
        title: result.announcement.title,
        ...(result.undo ? { action: { label: 'Undo', onClick: result.undo } } : {}),
      })
    }
  }

  return (
    <section
      {...{ [DOCK_ATTR]: '' }}
      aria-label={`Conversation: ${title}`}
      style={fullScreen ? undefined : { width }}
      className={cn(
        'flex flex-col overflow-hidden border border-hairline bg-page shadow-[var(--shadow-raised)]',
        fullScreen ? 'h-full w-full' : 'rounded-t-lg border-b-0',
        open && !fullScreen && 'h-[min(30rem,calc(100dvh-6rem))]',
      )}
    >
      {/* The header IS the minimise control, as LinkedIn's is: the whole bar is
          the target, and the two buttons on it stop the click from reaching it. */}
      <div
        className={cn(
          'flex h-12 shrink-0 items-center gap-1.5 border-b border-hairline px-2',
          !fullScreen && 'cursor-pointer',
        )}
        onClick={fullScreen ? undefined : () => onToggle(win.key)}
      >
        {onBack ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Back to conversations"
            onClick={(e) => {
              e.stopPropagation()
              onBack()
            }}
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} aria-hidden />
          </Button>
        ) : (
          <RobotIcon className="ml-1 size-5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </span>
        {busy ? (
          <Loader2
            className="size-3.5 shrink-0 animate-spin text-accent"
            strokeWidth={2}
            aria-label="Working"
          />
        ) : null}
        {win.threadId !== null ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-text-3"
            asChild
            onClick={(e) => e.stopPropagation()}
          >
            <Link
              to={assistantPath({ thread: win.threadId })}
              aria-label="Open in the Assistant"
              title="Open in the Assistant"
            >
              <Maximize2 className="size-3.5" strokeWidth={1.8} aria-hidden />
            </Link>
          </Button>
        ) : null}
        {!fullScreen ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-text-3"
            aria-label={win.minimized ? 'Open this conversation' : 'Minimise this conversation'}
            aria-expanded={!win.minimized}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(win.key)
            }}
          >
            {win.minimized ? (
              <ChevronUp className="size-4" strokeWidth={1.8} aria-hidden />
            ) : (
              <ChevronDown className="size-4" strokeWidth={1.8} aria-hidden />
            )}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-text-3"
          aria-label="Close this conversation"
          title="Close — it stays in your conversations"
          onClick={(e) => {
            e.stopPropagation()
            onClose(win.key)
          }}
        >
          <X className="size-4" strokeWidth={1.8} aria-hidden />
        </Button>
      </div>

      {open ? (
        <>
          {subject ? (
            <div className="flex shrink-0 items-center gap-1.5 border-b border-hairline px-3 py-1.5 text-xs text-text-2">
              <Briefcase className="size-3 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                About <span className="text-text-1">{displayName(subject)}</span>
              </span>
              <button
                type="button"
                aria-label={
                  win.threadId === null
                    ? 'Start this conversation about nothing in particular'
                    : 'Unfile this conversation from the application'
                }
                title={
                  win.threadId === null
                    ? 'Not about this application'
                    : 'Unfile from this application'
                }
                onClick={removeSubject}
                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-well hover:text-text-1"
              >
                <X className="size-3" strokeWidth={2} aria-hidden />
              </button>
            </div>
          ) : null}

          <div
            ref={box}
            onScroll={() => {
              const el = box.current
              if (el) stick.current = atBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
            }}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
          >
            {!configured ? (
              <p className="text-sm text-text-2">
                Connect a model in{' '}
                <Link to={settingsPath()} className="underline underline-offset-2">
                  Settings
                </Link>{' '}
                to chat with jojo here. Everything stays on this device.
              </p>
            ) : entries.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-text-2">
                  {subject
                    ? `Ask anything about ${displayName(subject)} — jojo knows this is the application you mean.`
                    : 'Ask jojo to find something, add an application, or move one along.'}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {(subject ? ABOUT_PROMPTS : GENERAL_PROMPTS).map((p) => (
                    <li key={p}>
                      <Button variant="outline" size="xs" disabled={busy} onClick={() => ask(p)}>
                        {p}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Transcript entries={entries} busy={busy} model={model} compact />
            )}
          </div>

          <div className="shrink-0 border-t border-hairline p-2">
            <Composer
              id={composerId}
              label={`Message jojo in ${title}`}
              value={prompt}
              onChange={setPrompt}
              onSend={ask}
              busy={busy}
              onStop={stop}
              disabled={!configured}
              placeholder={subject ? `Ask about ${subject.org}…` : 'Ask jojo…'}
              compact
            />
          </div>
        </>
      ) : null}
    </section>
  )
}
