import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CATALOG } from '@jojo/service/agent/catalog'
import type { NodeId } from '@jojo/service/core/model'
import type { useThreads } from '@jojo/service/react/use-threads'
import { report } from '@/lib/analytics'
import { useModelSettings } from '@/lib/model-settings-context'
import { atBottom } from '@/lib/scroll-stick'
import { useConversation } from '@/lib/use-conversation'

/**
 * The connected Assistant's conversation: which thread is open, the run in it,
 * the search over it, and keeping the newest turn in view.
 */
export function useConversationPanel(threads: ReturnType<typeof useThreads>['threads']) {
  const { settings } = useModelSettings()

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
  const transcriptRef = useRef<HTMLDivElement>(null)

  // Where the reader is, recorded as they move rather than measured when the
  // answer arrives — by then the effect has already had to decide.
  const onTranscriptScroll = () => {
    const box = transcriptRef.current
    if (box) stick.current = atBottom(box.scrollTop, box.scrollHeight, box.clientHeight)
  }

  /**
   * Keeps the newest turn in view.
   *
   * Never needed before, because the document scrolled and the page simply
   * grew. The transcript is its own scroll region now, so without this a new
   * answer — and the "Thinking" line while it works — lands below the fold of a
   * box the reader is looking straight at.
   */
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

  return {
    activeId,
    openThread,
    entries,
    busy,
    stop,
    clear,
    search,
    setSearch,
    transcriptRef,
    onTranscriptScroll,
    ask,
    onSend,
  }
}
