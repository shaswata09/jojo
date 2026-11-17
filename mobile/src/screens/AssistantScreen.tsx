import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReadDocument } from '@/lib/read-document'
import { contextOf } from '@jojo/service/core/provider'
import { useModelSettings } from '@/lib/model-settings-context'
import { agentTurn, isConfigured } from '@/lib/llm'
import type { ChatMessage } from '@jojo/service/core/model-server'
import { DEFAULT_THINKING, helperThinking } from '@jojo/service/core/model-server'
import { useAgent } from '@jojo/service/react/use-agent'
import type { RunSignal } from '@jojo/service/react/agent-runs'
import type { AgentEntry } from '@jojo/service/react/use-agent'
import {
  historyFor,
  toAgentEntries,
  toThreadEntries,
  useThreads,
} from '@jojo/service/react/use-threads'
import { useApplications } from '@/lib/store-context'
import type { NodeId } from '@jojo/service/core/model'
import { ThreadBar } from '@/components/assistant/ThreadBar'
import { ThreadListSheet } from '@/components/assistant/ThreadListSheet'
import type { AgentStep } from '@jojo/service/agent/loop'
import { CATALOG } from '@jojo/service/agent/catalog'
import { StepRow, Thinking } from '@/components/assistant/AgentTrace'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { Divider, Panel } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import type { SnippetTag } from '@jojo/service/data/vault'
import { useVault } from '@/lib/store-context'
import { useCopy } from '@/lib/use-copy'
import { useKeyboardOverlap } from '@/lib/use-keyboard-overlap'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { useColors } from '@/theme/theme-context'
import { Feather } from '@react-native-vector-icons/feather/static'
import { fonts, radius, space, type } from '@/theme/tokens'
import { report } from '@/lib/analytics'
import { toTab } from '@/navigation/to-tab'

/**
 * A worked example, and the prompt that produces it.
 *
 * Every reply on this screen comes from this list. Nothing is generated,
 * nothing is fetched, and no reply is ever shown without the badge saying so —
 * the badge is part of the component rather than something a call site can
 * forget.
 */
type Script = {
  id: string
  /** Words in a typed message that pick this script over the fallback. */
  cues: string[]
  /** The tag a snippet made from the reply is filed under. */
  tag: SnippetTag
}

/*
 * The words — the quick-action label, the reply, and the title a snippet made
 * from it is filed under — are in the `screens` catalog under
 * `assistant.scripts.<id>`, so each worked example reads in the reader's
 * language. The cues stay here: they are matched against what was typed.
 */
const SCRIPTS: Script[] = [
  {
    id: 'cover-letter',
    cues: ['cover letter', 'letter of application', 'motivation'],
    tag: 'Cover letter',
  },
  {
    id: 'tailor-cv',
    cues: ['cv', 'resume', 'tailor'],
    tag: 'Application form',
  },
  {
    id: 'parse-posting',
    cues: ['posting', 'parse', 'job ad', 'advert'],
    tag: 'Application form',
  },
  {
    id: 'follow-up',
    cues: ['follow up', 'follow-up', 'chase', 'nudge', 'email'],
    tag: 'Email',
  },
  {
    id: 'interview',
    cues: ['interview', 'job talk', 'chalk talk', 'campus visit'],
    tag: 'Application form',
  },
]

/**
 * What comes back when nothing in the message matches a script.
 *
 * It says what it is rather than improvising, because the alternative — a
 * plausible-sounding paragraph about whatever was typed — is the exact thing a
 * screen with no model behind it must not do.
 */
const FALLBACK: Script = {
  id: 'fallback',
  cues: [],
  tag: 'Application form',
}

/** First script with a cue in the message. Order in SCRIPTS breaks ties. */
function scriptFor(text: string): Script {
  const haystack = text.toLowerCase()
  return SCRIPTS.find((s) => s.cues.some((cue) => haystack.includes(cue))) ?? FALLBACK
}

/*
 * The system prompt and the history window both moved into the agent loop,
 * which owns the model-facing transcript now — see `kg/agent/loop.ts`. They
 * were duplicated here and in the web route, and a prompt that drifts between
 * two platforms is two assistants with the same name.
 */

type Message = {
  id: string
  role: 'you' | 'assistant'
  text: string
  /** Set when the reply came from the worked-example list rather than a model. */
  scriptId?: string
  /** Set when a real request failed, so the row can say what went wrong. */
  failed?: boolean
}

export function AssistantScreen() {
  const { settings } = useModelSettings()
  // Both composers sit at the foot of a scrolling screen, and on Android the
  // window is no longer resized for the keyboard (edge-to-edge). Padding the
  // frame by what the keyboard covers shrinks the scroller, and Android's
  // ScrollView keeps the focused input in view as it shrinks.
  const keyboard = useKeyboardOverlap()
  // The split is at the top because the two modes share almost nothing below it:
  // one has a transcript of messages and the other a trace of tool calls.
  return (
    <View
      ref={keyboard.ref}
      onLayout={keyboard.onLayout}
      style={[styles.keyboard, { paddingBottom: keyboard.overlap }]}
    >
      {isConfigured(settings) ? <AgentScreen /> : <ScriptedScreen />}
    </View>
  )
}

/* ---------------------------------- agent --------------------------------- */

/**
 * The assistant with a model behind it, acting on the records.
 *
 * The screen is a trace, not a chat. What the model SAID is one entry among
 * many; what it DID is the rest, and those are the entries a person came to
 * read. That ordering is `useAgent`'s flat entry list rendered straight through
 * — nothing here re-sorts or groups it, because an interleaving computed at
 * render time is one that can be computed wrongly.
 */
function AgentScreen() {
  const { t } = useTranslation('screens')
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { settings, reader } = useModelSettings()
  const { byId } = useApplications()
  const { threads, create, save, rename, file, remove, setApproval, setContext } = useThreads()

  /*
   * Which conversation is open, in state AND in a ref.
   *
   * The ref is what `onSettled` reads. It runs at the end of a run, from a
   * closure created when the run started, and by then the state it captured may
   * be a conversation ago — the first exchange of a NEW thread settles into a
   * thread that did not exist when `send` was called.
   */
  const [activeId, setActiveId] = useState<NodeId | null>(null)
  const activeRef = useRef<NodeId | null>(null)
  const openThread = (id: NodeId | null) => {
    activeRef.current = id
    setActiveId(id)
  }
  const active = threads.find((t) => t.id === activeId) ?? null
  const [browsing, setBrowsing] = useState(false)

  /**
   * Reopen the most recent conversation on arrival, once.
   *
   * Without it a relaunch lands on a blank thread with the whole history one tap
   * away, which reads as having lost it. Guarded by a ref rather than by
   * `activeId`, because New sets that back to null on purpose.
   */
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || threads.length === 0) return
    opened.current = true
    openThread(threads[0]?.id ?? null)
  }, [threads])
  const [prompt, setPrompt] = useState('')
  const { copy, isCopied } = useCopy()
  const { addSnippet } = useVault()
  const { toast } = useToast()

  /**
   * A destructive call, waiting on a person.
   *
   * The promise is held open in state until a button is pressed. That is the
   * whole approval mechanism: `runAgent` awaits `approve`, so the loop is
   * genuinely stopped — not racing a sheet — and nothing is written while the
   * question is on screen.
   */
  /*
   * The approval question is NOT held here any more.
   *
   * It used to be screen state resolved by a sheet rendered from this screen,
   * so the question existed only while the screen was on the stack. Leaving
   * mid-run — and every exit from this screen pops it — parked `runAgent` on
   * `await approve(...)` with nothing able to resolve it, forever, and the
   * exchange was never saved. The registry keeps it on the run and
   * `ApprovalSheet` draws it wherever the person is.
   */

  /**
   * Built per RUN, so Stop can cancel the request rather than only the loop.
   *
   * `agentTurn` has always taken a signal and no caller ever passed one, so
   * stopping left the socket open until the sixty-second timeout while the UI
   * already said the run had stopped — and the cancelled turn then arrived as a
   * red error blaming the model. The controller lives here because
   * `AbortController` is a platform global the shared layer may not name.
   */
  const llm = useCallback(
    (run: RunSignal) => {
      const controller = new AbortController()
      run.onAbort(() => {
        controller.abort()
      })
      return (messages: Parameters<typeof agentTurn>[1], tools: Parameters<typeof agentTurn>[2]) =>
        agentTurn(settings, messages, tools, controller.signal)
    },
    [settings],
  )

  /**
   * Saves an exchange, creating the conversation if this was the first one.
   *
   * Created at the SETTLE rather than at the send: creating it up front would
   * change the loaded thread's key mid-exchange, and the reload that follows
   * would replace the live turns with the empty ones just written — the user's
   * question vanishing as they watch.
   */
  /**
   * Mints the conversation for a first question, before the run starts.
   *
   * At send rather than at settle, so the run can be keyed by the conversation
   * it belongs to — and so the question is stored the moment it is asked. On a
   * phone that second half matters more than on the web: React Native suspends
   * JavaScript outright when the app leaves the foreground, so an interrupted
   * run is the ordinary case rather than the unlucky one, and this is what
   * leaves the question behind rather than nothing at all.
   */
  const startThread = useCallback(
    (asked: string) => {
      const made = create({ title: asked, entries: [{ kind: 'you', text: asked }] })
      if (!made.ok) return null
      openThread(made.output)
      return made.output
    },
    [create],
  )

  const onSettled = useCallback(
    (threadId: NodeId, settled: readonly AgentEntry[]) => {
      // The conversation this run was FOR, handed back by the registry. Reading
      // "which is open now" is what used to write one conversation's answer
      // into another.
      save(threadId, toThreadEntries(settled))
    },
    [save],
  )

  /**
   * Reading a document, if a reader is configured.
   *
   * `undefined` below when it is not, which is what makes `vault.file.read`
   * refuse with an explanation rather than fail.
   *
   * The body moved to `lib/read-document.ts` when the CV reader and the fit
   * assessment needed the same lookup — the same move web made with its copy.
   */
  const convert = useReadDocument()

  /*
   * Two more agents, each with its own model call and each allowed to fail.
   *
   * `chooser` reads the request and says which tools it needs — a name and a
   * line each is ~2,600 tokens against ~16,000 for the schemas, so choosing
   * costs about a sixth of what it saves and saves it on every round. It never
   * sees the conversation, which is what keeps it cheap as the chat grows.
   *
   * `summariser` runs only when the conversation no longer fits, and replaces
   * what a trim would have thrown away with a short note — so a long chat loses
   * detail rather than memory.
   *
   * Both take the same transport as the main loop here. They do not have to:
   * choosing from a list and summarising are far easier than doing the work,
   * and an app that wanted to point them at a smaller model would change only
   * these two lines.
   */
  const chooser = useMemo(() => {
    // Minimal reasoning for the helpers — see `helperThinking`.
    const helper = { ...settings, thinking: helperThinking(settings.thinking ?? DEFAULT_THINKING) }
    return { ask: (messages: readonly ChatMessage[]) => agentTurn(helper, messages, []) }
  }, [settings])

  const { entries, busy, send, stop, clear } = useAgent({
    llm,
    chooser,
    summariser: chooser,
    onSettled,
    startThread,
    /*
     * The person's own context window, or the provider's default.
     *
     * This is the surface where it matters most: the Assistant is the only one
     * that keeps a conversation, and measured over ten ordinary follow-ups the
     * request grew 8,227 → 21,062 tokens with nothing bounding it. Without this
     * the loop cannot trim, and the SERVER truncates instead — from the front,
     * where the system prompt is.
     */
    window: contextOf(settings),
    ...(reader ? { convert } : {}),
    /*
     * Persist a summary the loop writes, so the next turn sends it instead of
     * summarising the same exchanges again. Rare: only a conversation that has
     * outgrown the model's window ever reaches this.
     */
    onCompacted: setContext,
    thread: {
      id: activeId,
      entries: active ? toAgentEntries(active.entries) : [],
      /*
       * The part the stored summary does NOT cover — and, ahead of it, the
       * person's own turns from the part it does.
       *
       * `contextThrough` is where a previous compaction reached; sending those
       * entries again alongside the summary would defeat the compaction and
       * make the conversation grow faster than before it happened. But the
       * summary holds no user words by design (the summariser never sees a
       * user turn), so the loop carries them verbatim instead — and a boundary
       * advanced past them lost them on the very next turn. `historyFor` does
       * the replay and the slice as one reading, so this screen and the other
       * cannot disagree about it; see `use-threads.ts`.
       */
      history: active ? historyFor(active.entries, active.contextThrough).history : [],
      ...(active?.context === undefined ? {} : { context: active.context }),
      approval: active?.approval ?? 'manual',
    },
  })

  const submit = () => {
    const clean = prompt.trim()
    if (!clean || busy) return
    setPrompt('')
    // That a question was asked, and nothing about the question — as on the web.
    void report('assistant_asked', { tools_available: CATALOG.length, has_model: true })
    void send(clean)
  }

  /**
   * Undoing one step of the agent's work.
   *
   * Goes through the same `undo` the toast on a button press would have called,
   * because it IS that undo. The row stays on screen afterwards: the trace is a
   * record of what happened, and a step vanishing when it is reverted would make
   * the record wrong.
   */
  const undoStep = (step: AgentStep) => {
    step.undo?.()
    toast({
      title: t('assistant.undone'),
      description: step.announcement?.title ?? step.title,
      tone: 'danger',
    })
  }

  /** The question that produced a given answer, for the snippet's title. */
  const askedBefore = (index: number) => {
    for (let i = index - 1; i >= 0; i--) {
      const e = entries[i]
      if (e?.kind === 'you') return e.text
    }
    return t('assistant.title')
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
      title: t('assistant.saved'),
      description: t('assistant.savedDescription', { title: snippet.title, tag: snippet.tag }),
      action: {
        label: t('assistant.openVault'),
        onPress: () => toTab(navigation, 'Vault', { tool: 'snippets' }),
      },
    })
  }

  return (
    <Screen
      title={t('assistant.title')}
      subtitle={t('assistant.agent.subtitle')}
      actions={
        entries.length > 0 ? (
          <Button
            label={t('assistant.clear')}
            variant="ghost"
            disabled={busy}
            onPress={() => {
              clear()
              openThread(null)
            }}
          />
        ) : null
      }
    >
      <Panel>
        <Txt size="sm" tone="secondary">
          <Trans
            t={t}
            i18nKey="assistant.agent.intro"
            values={{ model: settings.model, endpoint: settings.endpoint, tools: CATALOG.length }}
            components={{ code: <Txt mono /> }}
          />
        </Txt>
      </Panel>

      <Panel>
        <ThreadBar
          threads={threads}
          activeId={activeId}
          byId={byId}
          busy={busy}
          onBrowse={() => setBrowsing(true)}
          onRename={(id, title) => {
            rename(id, title)
          }}
          onFile={(id, applicationId) => {
            const result = file(id, applicationId)
            if (result.ok) {
              toast({
                title: result.announcement.title,
                ...(result.undo
                  ? { action: { label: t('shared.undo'), onPress: result.undo } }
                  : {}),
              })
            }
          }}
          onSetApproval={(id, mode) => {
            setApproval(id, mode)
          }}
          onDelete={(id) => {
            const result = remove(id)
            if (!result.ok) return
            // The open conversation just stopped existing; showing its turns
            // under a title that is gone reads as a failed delete.
            clear()
            openThread(null)
            toast({
              title: t('assistant.agent.deleted'),
              tone: 'danger',
              ...(result.undo ? { action: { label: t('shared.undo'), onPress: result.undo } } : {}),
            })
          }}
        />
        <Divider style={{ marginVertical: space[3] }} />

        {entries.length === 0 ? (
          <EmptyState
            icon="cpu"
            title={t('assistant.emptyTitle')}
            description={t('assistant.agent.emptyDescription')}
          />
        ) : (
          /*
           * Announced as it changes. A reply after a ten-second run, and the
           * error card below it, both landed in silence — so a screen-reader
           * user had no way to know the assistant had finished, or failed.
           * `polite` because the answer is worth hearing after whatever the
           * person is doing, not on top of it.
           */
          <View style={{ gap: space[3] }} accessibilityLiveRegion="polite">
            {entries.map((entry, index) => {
              if (entry.kind === 'you') {
                return (
                  <View key={entry.id} style={{ alignItems: 'flex-end' }}>
                    <View style={[styles.you, { backgroundColor: c.well }]}>
                      <Txt size="sm">{entry.text}</Txt>
                    </View>
                  </View>
                )
              }
              if (entry.kind === 'step') {
                return <StepRow key={entry.id} step={entry.step} onUndo={undoStep} />
              }
              if (entry.kind === 'thought') {
                return (
                  <ThoughtRow
                    key={entry.id}
                    text={entry.text}
                    live={busy && index === entries.length - 1}
                  />
                )
              }
              if (entry.kind === 'note') {
                // Narration while it is still working. Quieter than an answer on
                // purpose: it is not the reply, and styling it like one makes a
                // run look finished when it is not.
                return (
                  <Txt key={entry.id} size="sm" tone="muted" style={{ fontStyle: 'italic' }}>
                    {entry.text}
                  </Txt>
                )
              }
              if (entry.kind === 'error') {
                return (
                  <View
                    key={entry.id}
                    style={[styles.reply, { borderColor: c.danger, backgroundColor: c.dangerSoft }]}
                  >
                    <Txt size="sm" tone="danger">
                      {entry.text}
                    </Txt>
                  </View>
                )
              }
              return (
                <View key={entry.id} style={[styles.reply, { borderColor: c.hairline }]}>
                  <Txt size="sm">{entry.text}</Txt>
                  <View style={styles.replyActions}>
                    <Button
                      label={isCopied(entry.id) ? t('assistant.copied') : t('assistant.copy')}
                      icon={isCopied(entry.id) ? 'check' : 'copy'}
                      variant="ghost"
                      onPress={() => copy(entry.text, entry.id)}
                    />
                    <Button
                      label={t('assistant.saveToSnippets')}
                      icon="bookmark"
                      variant="ghost"
                      onPress={() => {
                        saveAnswer(entry.text, askedBefore(index))
                      }}
                    />
                  </View>
                </View>
              )
            })}
            {/* Only while nothing else is moving. A spinner under a step that is
                already spinning says the same thing twice. */}
            {busy && entries.at(-1)?.kind !== 'step' && entries.at(-1)?.kind !== 'thought' ? (
              <Thinking model={settings.model} />
            ) : null}
          </View>
        )}

        {/* Openers, and ONLY while the thread is empty — the web app does the
            same, in the same place, for the same reason. They are what a person
            reads when they do not know what to ask, which stops being true the
            moment they have asked. Left in permanently they sat between the
            transcript and the box, so every turn pushed a row of unrelated
            prompts against the last reply and squeezed the conversation. */}
        {entries.length === 0 ? (
          <View style={[styles.prompts, { marginBottom: space[2] }]}>
            {AGENT_PROMPTS.map((key) => {
              const p = t(`assistant.agent.prompts.${key}`)
              return (
                <Button
                  key={key}
                  label={p}
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onPress={() => {
                    send(p)
                  }}
                />
              )
            })}
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder={t('assistant.agent.placeholder')}
            placeholderTextColor={c.text3}
            accessibilityLabel={t('assistant.ask')}
            returnKeyType="send"
            editable={!busy}
            onSubmitEditing={submit}
            style={[
              styles.input,
              {
                color: busy ? c.text3 : c.text1,
                backgroundColor: c.well,
                borderColor: c.hairlineStrong,
              },
            ]}
          />
          {busy ? (
            // Stop rather than a disabled send: a run that has gone wrong is
            // exactly when a person most needs a control, and the loop checks
            // the flag between every round.
            <Button label={t('assistant.stop')} variant="outline" onPress={stop} />
          ) : (
            <IconButton
              icon="arrow-up"
              label={t('assistant.send')}
              disabled={!prompt.trim()}
              onPress={submit}
            />
          )}
        </View>
      </Panel>

      <Txt size="sm" tone="secondary">
        {t('assistant.agent.footer')}
      </Txt>

      <ThreadListSheet
        open={browsing}
        threads={threads}
        activeId={activeId}
        byId={byId}
        onOpen={openThread}
        onNew={() => {
          clear()
          openThread(null)
        }}
        onClose={() => setBrowsing(false)}
      />
    </Screen>
  )
}

/**
 * Openers that exercise the surface rather than showing off.
 *
 * Two reads and two writes, and each one is a task with an id in the middle of
 * it — which is the shape that actually tests whether a small model can chain
 * `memory.search` into a write instead of inventing an id.
 */
const AGENT_PROMPTS = ['waiting', 'add', 'noDeadline', 'flag'] as const

/* --------------------------------- scripted -------------------------------- */

/**
 * The assistant with no model behind it.
 *
 * Everything here is a worked example and says so. This was the whole screen
 * before Settings could reach a model, and it is unchanged in behaviour — what
 * changed is that it no longer has to ASK whether one is connected, because
 * `AssistantScreen` above answered that before rendering it.
 */
function ScriptedScreen() {
  const { t } = useTranslation('screens')
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState('')
  const nextId = useRef(0)
  const { copy, isCopied } = useCopy()

  const { addSnippet } = useVault()
  const { toast } = useToast()

  /**
   * The unconnected path, and the only one this screen had for its whole life.
   *
   * No model, no request, no delay. Every message it produces carries
   * `scriptId`, which is what puts the badge on it.
   */
  const send = (text: string, chosen?: Script) => {
    const clean = text.trim()
    if (!clean) return
    const at = nextId.current
    nextId.current += 2
    setPrompt('')
    // A quick action names its script outright: its label is translated, and
    // the cues it would otherwise be matched by are not.
    const script = chosen ?? scriptFor(clean)
    setMessages((prev) => [
      ...prev,
      { id: `m${at}`, role: 'you', text: clean },
      {
        id: `m${at + 1}`,
        role: 'assistant',
        text: t(`assistant.scripts.${script.id}.reply`),
        scriptId: script.id,
      },
    ])
  }

  const saveToSnippets = (message: Message) => {
    const script = SCRIPTS.find((s) => s.id === message.scriptId) ?? FALLBACK
    const snippet = addSnippet({
      title: t(`assistant.scripts.${script.id}.title`),
      tag: script.tag,
      body: message.text,
    })
    toast({
      title: t('assistant.saved'),
      description: t('assistant.savedDescription', { title: snippet.title, tag: snippet.tag }),
      action: {
        label: t('assistant.openVault'),
        onPress: () => toTab(navigation, 'Vault', { tool: 'snippets' }),
      },
    })
  }

  /** A conversation of canned replies is the cheapest record in the app. */
  const clearConversation = () => {
    const previous = messages
    setMessages([])
    toast({
      title: t('assistant.scripted.cleared'),
      description: t('assistant.scripted.messages', { count: previous.length }),
      tone: 'danger',
      action: { label: t('shared.undo'), onPress: () => setMessages(previous) },
    })
  }

  return (
    <Screen
      title={t('assistant.title')}
      subtitle={t('assistant.scripted.subtitle')}
      actions={
        messages.length > 0 ? (
          <Button label={t('assistant.clear')} variant="ghost" onPress={clearConversation} />
        ) : undefined
      }
    >
      {/*
       * A banner, and somewhere to press.
       *
       * The subtitle said "connect a local model" and offered no way to do it
       * — so the one screen where a person discovers the assistant needs a
       * model was also the one screen with no route to the setting. Web has
       * had a warning strip with a link to Settings since it was written.
       */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('assistant.scripted.connectLabel')}
        onPress={() => navigation.navigate('Settings' as never)}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space[2.5],
          backgroundColor: c.warningSoft,
          borderColor: c.warningBorder,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          padding: space[3],
          marginBottom: space[3],
          minHeight: 44,
        }}
      >
        <Feather name="alert-triangle" size={16} color={c.warning} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, gap: space[1] }}>
          <Txt size="sm" color={c.warning}>
            {t('assistant.scripted.banner')}
          </Txt>
          <Txt size="sm" color={c.warning} weight="medium">
            {t('assistant.scripted.connect')}
          </Txt>
        </View>
      </Pressable>

      {/* Stated once, at the top, in the same words the Job scout uses for the
          same fact. The per-reply badge below repeats it because a reply that
          scrolled away from this banner would otherwise read as a real answer. */}
      <Panel>
        {messages.length === 0 ? (
          <EmptyState
            icon="message-square"
            title={t('assistant.emptyTitle')}
            description={t('assistant.scripted.emptyDescription')}
          />
        ) : (
          <View style={{ gap: space[3] }}>
            {messages.map((m) =>
              m.role === 'you' ? (
                <View key={m.id} style={styles.youRow}>
                  <View style={[styles.you, { backgroundColor: c.well }]}>
                    <Txt size="sm">{m.text}</Txt>
                  </View>
                </View>
              ) : (
                <View key={m.id} style={[styles.reply, { borderColor: c.hairline }]}>
                  {/* Keyed to the message, not to the branch. This was an
                      unconditional amber chip and the comment above it said
                      that was deliberate — true while every reply on this screen
                      WAS an example, and false the moment `send` learned to call
                      a real model. Caught on a device: a genuine 400 from vLLM
                      was rendered under the words "no model connected", which is
                      the one thing a badge like this must never say wrongly.

                      Present `scriptId` means example; `failed` means the
                      request went out and did not come back; neither means it is
                      a model's answer and wears nothing. */}
                  <Chip tone="amber" size="sm">
                    {t('assistant.scripted.badge')}
                  </Chip>
                  <Txt size="sm" style={{ marginTop: space[2] }}>
                    {m.text}
                  </Txt>
                  <View style={styles.replyActions}>
                    <Button
                      label={isCopied(m.id) ? t('assistant.copied') : t('assistant.copy')}
                      icon={isCopied(m.id) ? 'check' : 'copy'}
                      variant="ghost"
                      onPress={() => copy(m.text, m.id)}
                    />
                    <Button
                      label={t('assistant.saveToSnippets')}
                      icon="bookmark"
                      variant="ghost"
                      onPress={() => saveToSnippets(m)}
                    />
                  </View>
                </View>
              ),
            )}
          </View>
        )}

        {/* Empty thread only, same as the connected panel — the two must not
            diverge for the person who has not set a model up yet, and that
            includes when the openers disappear. */}
        {messages.length === 0 ? (
          <View style={[styles.prompts, { marginBottom: space[2] }]}>
            {SCRIPTS.map((s) => (
              <Button
                key={s.id}
                label={t(`assistant.scripts.${s.id}.action`)}
                variant="outline"
                size="sm"
                onPress={() => {
                  send(t(`assistant.scripts.${s.id}.action`), s)
                }}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder={t('assistant.scripted.placeholder')}
            placeholderTextColor={c.text3}
            accessibilityLabel={t('assistant.ask')}
            returnKeyType="send"
            onSubmitEditing={() => {
              send(prompt)
            }}
            style={[
              styles.input,
              { color: c.text1, backgroundColor: c.well, borderColor: c.hairlineStrong },
            ]}
          />
          <IconButton
            icon="arrow-up"
            label={t('assistant.send')}
            disabled={!prompt.trim()}
            onPress={() => {
              send(prompt)
            }}
          />
        </View>
      </Panel>

      <Txt size="sm" tone="secondary">
        {t('assistant.scripted.footer')}
      </Txt>
    </Screen>
  )
}

const styles = StyleSheet.create({
  youRow: { alignItems: 'flex-end' },
  you: {
    maxWidth: '88%',
    borderRadius: radius.lg,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  reply: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space[3] },
  replyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2.5] },
  keyboard: { flex: 1 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[4] },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    fontFamily: fonts.regular,
    fontSize: type.base,
  },
  prompts: { gap: space[2], alignItems: 'flex-start' },
})

/**
 * What the model thought before answering, folded away — the web transcript's
 * `ThoughtRow`, for the phone. Closed by default; while it is still being
 * written it says "Thinking…" and shows its latest line.
 */
function ThoughtRow({ text, live }: { text: string; live: boolean }) {
  const { t } = useTranslation('screens')
  const [open, setOpen] = useState(false)
  const latest = text.trim().split('\n').filter(Boolean).at(-1) ?? ''
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={live ? t('assistant.thought.liveLabel') : t('assistant.thought.label')}
        onPress={() => setOpen((was) => !was)}
        hitSlop={8}
      >
        <Txt size="xs" tone="muted">
          {open ? '▾ ' : '▸ '}
          {live ? t('assistant.thought.live') : t('assistant.thought.done')}
        </Txt>
      </Pressable>
      {open ? (
        <Txt size="xs" tone="muted" style={{ marginTop: space[1], paddingLeft: space[3] }}>
          {text}
        </Txt>
      ) : live && latest ? (
        <Txt
          size="xs"
          tone="muted"
          numberOfLines={1}
          style={{ marginTop: space[1], fontStyle: 'italic' }}
        >
          {latest}
        </Txt>
      ) : null}
    </View>
  )
}
