import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { RobotIcon } from '@/components/brand/RobotIcon'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelScroll } from '@/components/common/Panel'
import { useModelSettings } from '@/lib/model-settings-context'
import { useFillViewport } from '@/lib/use-fill-viewport'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'
import { useApplications } from '@jojo/service/react/use-applications'
import { useThreads } from '@jojo/service/react/use-threads'
import { AgentHeader } from './AgentHeader'
import { Composer } from './Composer'
import { OpenerList } from './OpenerList'
import { ThreadBar } from './ThreadBar'
import { ThreadList } from './ThreadList'
import { Transcript } from './Transcript'
import { useConversationPanel } from './use-conversation-panel'
import { useThreadActions } from './use-thread-actions'

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
].map((p) => ({ key: p, label: p }))

/**
 * The assistant with a model behind it, acting on the records.
 *
 * The page is a trace, not a chat. What the model SAID is one entry among many;
 * what it DID is the rest, and those are the entries a person came to read. That
 * ordering is `useAgent`'s flat entry list rendered straight through — nothing
 * here re-sorts or groups it, because an interleaving computed at render time is
 * one that can be computed wrongly.
 */
export function AgentPanel() {
  const { settings } = useModelSettings()
  const { all: applications, byId } = useApplications()
  const threadStore = useThreads()
  const { threads, rename, setApproval } = threadStore
  const c = useConversationPanel(threads)
  const { onFile, onDelete } = useThreadActions(threadStore, c)
  const [prompt, setPrompt] = useState('')

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
  const fill = useFillViewport(20, 420)
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  return (
    <>
      <AgentHeader
        model={settings.model}
        endpoint={settings.endpoint}
        canClear={c.entries.length > 0}
        busy={c.busy}
        onClear={() => {
          c.clear()
          c.openThread(null)
        }}
      />

      {/* `min-h-0 flex-1` is the seam AppShell documents: it hands a page the
          height left over, so the conversation can own it instead of the card
          sitting in the top third of an empty screen. */}
      {/* Side by side, the ROW is what is capped, and both panels fill it.
          Capping only the conversation let the list beside it set the row's
          height: six threads made the list taller than the cap, and the
          conversation ended short with empty space under it. Stacked, the
          panels are not in one row, so the conversation keeps its own cap. */}
      <div
        ref={isDesktop ? fill.ref : undefined}
        style={isDesktop ? { maxHeight: fill.maxHeight } : undefined}
        className="grid min-h-0 min-w-0 flex-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <ThreadList
          fill={isDesktop}
          threads={threads}
          activeId={c.activeId}
          byId={byId}
          query={c.search}
          onQuery={c.setSearch}
          onOpen={c.openThread}
          onNew={() => {
            // No `clear()`. It forgets the run for the conversation being left,
            // and leaving a conversation is now exactly when it should keep
            // going. Opening nothing is the whole of "new".
            c.openThread(null)
          }}
        />

        {/* Capped by measurement, not by `flex-1`.
            The shell is `min-h-dvh` — a minimum, not a definite height — so a
            flex child fills the space when the conversation is short and simply
            grows when it is long, scrolling the page instead of itself. That is
            the exact failure `useFillViewport` was written for, and the
            applications table is the precedent. */}
        <Panel
          ref={isDesktop ? undefined : fill.ref}
          style={isDesktop ? undefined : { maxHeight: fill.maxHeight }}
          className="flex min-h-0 min-w-0 flex-col"
        >
          <ThreadBar
            threads={threads}
            activeId={c.activeId}
            applications={applications}
            busy={c.busy}
            onSetApproval={(id, mode) => {
              setApproval(id, mode)
            }}
            onRename={(id, title) => {
              rename(id, title)
            }}
            onFile={onFile}
            onDelete={onDelete}
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
          <PanelScroll axis="y" bleed="sides" ref={c.transcriptRef} onScroll={c.onTranscriptScroll}>
            {c.entries.length === 0 ? (
              <EmptyState
                icon={RobotIcon as unknown as LucideIcon}
                title="Nothing asked yet"
                description="Ask it to find something, add an application, or move one along. Each tool it runs appears below as it happens, with what it sent and what came back."
              />
            ) : (
              <Transcript
                entries={c.entries}
                busy={c.busy}
                model={settings.model}
                query={c.search}
              />
            )}
          </PanelScroll>

          {/* Openers, and ONLY while the thread is empty.
            They are what a person reads when they do not know what to ask —
            which stops being true the moment they have asked something. Left in
            permanently they sat between the transcript and the box, so every
            turn pushed a row of unrelated prompts up against the last reply and
            squeezed the conversation the person actually came to read. An
            opener has no job in a conversation already under way. */}
          {c.entries.length === 0 ? (
            <OpenerList openers={AGENT_PROMPTS} disabled={c.busy} onPick={c.ask} />
          ) : null}

          <div className="mt-2">
            <Composer
              id="assistant-prompt"
              label="Ask the assistant"
              value={prompt}
              onChange={setPrompt}
              onSend={c.onSend}
              busy={c.busy}
              onStop={c.stop}
              placeholder="Find my UT Austin application, or add one, or move it to interview…"
            />
          </div>
        </Panel>
      </div>
    </>
  )
}
