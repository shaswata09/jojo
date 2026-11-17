import { memo, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
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
import type { DockDrag } from '@/components/chat-dock/ChatDock'
import { shouldTakeFocus } from '@/components/chat-dock/take-focus'

/**
 * Openers for a conversation about one application — the questions people ask
 * beside a record. Catalog keys: each is shown and sent in the reader's language.
 */
const ABOUT_PROMPTS = ['prompts.about.left', 'prompts.about.followUp', 'prompts.about.summarise']
/** And for a conversation about nothing in particular. */
const GENERAL_PROMPTS = ['prompts.general.waiting', 'prompts.general.noDeadline']

/*
 * The transcript, skipped when its props have not changed.
 *
 * Wrapped here rather than inside `Transcript`, which the Assistant page draws
 * too. A long conversation is the most expensive thing the dock renders — every
 * turn is Markdown — and the window re-renders for reasons that are not about
 * it: the dock moving, another window opening. Typing is kept out of this
 * component altogether (see `DockComposer`); this is for the rest.
 */
const DockTranscript = memo(Transcript)

/**
 * The composer, holding its own text.
 *
 * The text was state on `ChatWindow`, so every keystroke re-rendered the whole
 * window and the whole Markdown transcript under it: 58 ms a key in a
 * 150-question conversation in development, against 19 ms without it. Here a
 * keystroke re-renders this and nothing else.
 *
 * `draft` is the window's ref, written on every change, because this component
 * unmounts when the window is minimised and the half-written question has to
 * be there when it opens again — which the window's own state used to give for
 * free.
 */
function DockComposer({
  draft,
  ...props
}: Omit<Parameters<typeof Composer>[0], 'value' | 'onChange'> & {
  draft: RefObject<string>
}) {
  const [value, setValue] = useState(draft.current)
  return (
    <Composer
      {...props}
      value={value}
      onChange={(next) => {
        draft.current = next
        setValue(next)
      }}
    />
  )
}

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
  drag,
  dockUsed = false,
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
  /** Moving the whole dock by this header. Absent full screen, where there is nowhere to move it. */
  drag?: DockDrag | undefined
  /** The person has used the dock since it mounted — see `take-focus.ts`. */
  dockUsed?: boolean | undefined
}) {
  const { t } = useTranslation('chatDock')
  const { file } = useThreads()
  const { toast } = useToast()
  const convo = useConversation({
    threadId: win.threadId as NodeId | null,
    applicationId: win.threadId === null ? win.applicationId : null,
    onStarted: (id) => onAdopt(win.key, id),
  })
  const { entries, busy, send, stop, thread, subject, configured, model } = convo

  const draft = useRef('')
  const title = thread?.title ?? t('newConversation')
  const open = fullScreen || !win.minimized

  /* Stick to the newest turn unless the reader scrolled up — the page's rule. */
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [entries, busy, open])

  /* A window the person opened out takes the caret, so typing can start at
     once — but not one that merely mounted open (a reload, a return from the
     Assistant page). `take-focus.ts` has the rule. */
  const composerId = `dock-prompt-${win.key}`
  const seen = useRef<{ open: boolean; showing: string } | null>(null)
  useEffect(() => {
    const prev = seen.current
    seen.current = { open, showing: composerId }
    const take = shouldTakeFocus({
      open,
      wasOpen: prev?.open ?? null,
      showing: composerId,
      wasShowing: prev?.showing ?? null,
      dockUsed,
    })
    if (take) document.getElementById(composerId)?.focus()
  }, [open, composerId, dockUsed])

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
        ...(result.undo ? { action: { label: t('undo'), onClick: result.undo } } : {}),
      })
    }
  }

  return (
    <section
      {...{ [DOCK_ATTR]: '' }}
      aria-label={t('window.label', { title })}
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
          !fullScreen && 'cursor-pointer touch-none select-none',
          drag && !fullScreen && 'ps-1',
        )}
        // The header moves the whole dock, the same as the bar does — an open
        // conversation is the biggest thing the dock puts over the page, so it
        // is the one most worth being able to push aside.
        onPointerDown={fullScreen ? undefined : drag?.onPointerDown}
        onClick={
          fullScreen
            ? undefined
            : () => {
                if (drag?.swallowClick()) return
                onToggle(win.key)
              }
        }
      >
        {drag && !fullScreen ? drag.grip : null}
        {onBack ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={t('window.back')}
            // Where focus goes when the window before this one was closed and
            // the layout shows one panel at a time (`ChatDock`'s `onClose`).
            data-dock-home=""
            onClick={(e) => {
              e.stopPropagation()
              onBack()
            }}
          >
            <ArrowLeft className="size-4 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden />
          </Button>
        ) : (
          <RobotIcon className="ms-1 size-5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
          {title}
        </span>
        {busy ? (
          <Loader2
            className="size-3.5 shrink-0 animate-spin text-accent"
            strokeWidth={2}
            aria-label={t('window.working')}
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
              aria-label={t('window.openInAssistant')}
              title={t('window.openInAssistant')}
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
            aria-label={win.minimized ? t('window.open') : t('window.minimise')}
            aria-expanded={!win.minimized}
            data-dock-home=""
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
          aria-label={t('window.close')}
          title={t('window.closeTitle')}
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
                <Trans
                  t={t}
                  i18nKey="window.about"
                  values={{ name: displayName(subject) }}
                  components={{ name: <span className="text-text-1" /> }}
                />
              </span>
              <button
                type="button"
                aria-label={win.threadId === null ? t('window.detachAria') : t('window.unfileAria')}
                title={win.threadId === null ? t('window.detachTitle') : t('window.unfileTitle')}
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
                <Trans
                  t={t}
                  i18nKey="window.notConfigured"
                  components={{
                    settings: <Link to={settingsPath()} className="underline underline-offset-2" />,
                  }}
                />
              </p>
            ) : entries.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-text-2">
                  {subject
                    ? t('window.askAbout', { name: displayName(subject) })
                    : t('window.askGeneral')}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {(subject ? ABOUT_PROMPTS : GENERAL_PROMPTS).map((p) => (
                    <li key={p}>
                      <Button variant="outline" size="xs" disabled={busy} onClick={() => ask(t(p))}>
                        {t(p)}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <DockTranscript entries={entries} busy={busy} model={model} compact />
            )}
          </div>

          <div className="shrink-0 border-t border-hairline p-2">
            <DockComposer
              id={composerId}
              label={t('window.composerLabel', { title })}
              draft={draft}
              onSend={ask}
              busy={busy}
              onStop={stop}
              disabled={!configured}
              placeholder={
                subject
                  ? t('window.placeholderAbout', { org: subject.org })
                  : t('window.placeholder')
              }
              compact
            />
          </div>
        </>
      ) : null}
    </section>
  )
}
