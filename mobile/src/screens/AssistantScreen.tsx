import { useCallback, useEffect, useRef, useState } from 'react'
import { useReadDocument } from '@/lib/read-document'
import { useModelSettings } from '@/lib/model-settings-context'
import { agentTurn, isConfigured } from '@/lib/llm'
import { useAgent } from '@jojo/service/react/use-agent'
import type { RunSignal } from '@jojo/service/react/agent-runs'
import type { AgentEntry } from '@jojo/service/react/use-agent'
import {
  toAgentEntries,
  toThreadEntries,
  toTranscript,
  useThreads,
} from '@jojo/service/react/use-threads'
import { useApplications } from '@/lib/store-context'
import type { NodeId } from '@jojo/service/core/model'
import { ThreadBar } from '@/components/assistant/ThreadBar'
import { ThreadListSheet } from '@/components/assistant/ThreadListSheet'
import type { AgentStep } from '@jojo/service/agent/loop'
import { CATALOG } from '@jojo/service/agent/catalog'
import { StepRow, Thinking } from '@/components/assistant/AgentTrace'
import { StyleSheet, TextInput, View } from 'react-native'
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
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'

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
 * screen with no model behind it must not do.
 */
const FALLBACK: Script = {
  id: 'fallback',
  action: '',
  cues: [],
  title: 'Assistant — example response',
  tag: 'Application form',
  reply:
    'No model is connected, so this is a canned answer rather than a reply to what you typed.\n\n' +
    'With one connected, this screen would read your profile, the documents in your Vault and the application ' +
    'you name, then draft against them on your own device. Point jojo at a local OpenAI-compatible server ' +
    'in Settings — vLLM, Ollama or LM Studio.\n\n' +
    'The five prompts below each have a worked example you can use in the meantime.',
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
  // The split is at the top because the two modes share almost nothing below it:
  // one has a transcript of messages and the other a trace of tool calls.
  return isConfigured(settings) ? <AgentScreen /> : <ScriptedScreen />
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
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { settings, reader } = useModelSettings()
  const { byId } = useApplications()
  const { threads, create, save, rename, file, remove, setAuto } = useThreads()

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

  const { entries, busy, send, stop, clear } = useAgent({
    llm,
    onSettled,
    startThread,
    ...(reader ? { convert } : {}),
    thread: {
      id: activeId,
      entries: active ? toAgentEntries(active.entries) : [],
      history: active ? toTranscript(active.entries) : [],
      autoApprove: active?.autoApprove ?? false,
    },
  })

  const submit = () => {
    const clean = prompt.trim()
    if (!clean || busy) return
    setPrompt('')
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
      title: 'Undone',
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
    return 'Assistant'
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
      action: {
        label: 'Open vault',
        onPress: () =>
          navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'snippets' } }),
      },
    })
  }

  return (
    <Screen
      title="Assistant"
      subtitle="Connected to your model, and able to act on your records. Everything it does is listed as it happens."
      actions={
        entries.length > 0 ? (
          <Button
            label="Clear"
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
          Answering with <Txt mono>{settings.model}</Txt> at <Txt mono>{settings.endpoint}</Txt>,
          which can call {CATALOG.length} tools on this device. Nothing is sent anywhere else, and
          every change can be undone.
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
                ...(result.undo ? { action: { label: 'Undo', onPress: result.undo } } : {}),
              })
            }
          }}
          onSetAuto={(id, auto) => {
            setAuto(id, auto)
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
              ...(result.undo ? { action: { label: 'Undo', onPress: result.undo } } : {}),
            })
          }}
        />
        <Divider style={{ marginVertical: space[3] }} />

        {entries.length === 0 ? (
          <EmptyState
            icon="cpu"
            title="Nothing asked yet"
            description="Ask it to find something, add an application, or move one along. Each tool it runs appears below as it happens, with what it sent and what came back."
          />
        ) : (
          <View style={{ gap: space[3] }}>
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
                      label={isCopied(entry.id) ? 'Copied' : 'Copy'}
                      icon={isCopied(entry.id) ? 'check' : 'copy'}
                      variant="ghost"
                      onPress={() => copy(entry.text, entry.id)}
                    />
                    <Button
                      label="Save to snippets"
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
            {busy && entries.at(-1)?.kind !== 'step' ? <Thinking model={settings.model} /> : null}
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
            {AGENT_PROMPTS.map((p) => (
              <Button
                key={p}
                label={p}
                variant="outline"
                size="sm"
                disabled={busy}
                onPress={() => {
                  send(p)
                }}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Find my UT Austin application, add one, move it along…"
            placeholderTextColor={c.text3}
            accessibilityLabel="Ask the assistant"
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
            <Button label="Stop" variant="outline" onPress={stop} />
          ) : (
            <IconButton icon="arrow-up" label="Send" disabled={!prompt.trim()} onPress={submit} />
          )}
        </View>
      </Panel>

      <Txt size="sm" tone="secondary">
        It reads before it writes, asks before each change unless you turn that off for a
        conversation, and everything it does goes through the same undo a button press does.
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
 * Everything here is a worked example and says so. This was the whole screen
 * before Settings could reach a model, and it is unchanged in behaviour — what
 * changed is that it no longer has to ASK whether one is connected, because
 * `AssistantScreen` above answered that before rendering it.
 */
function ScriptedScreen() {
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
  const send = (text: string) => {
    const clean = text.trim()
    if (!clean) return
    const at = nextId.current
    nextId.current += 2
    setPrompt('')
    const script = scriptFor(clean)
    setMessages((prev) => [
      ...prev,
      { id: `m${at}`, role: 'you', text: clean },
      { id: `m${at + 1}`, role: 'assistant', text: script.reply, scriptId: script.id },
    ])
  }

  const saveToSnippets = (message: Message) => {
    const script = SCRIPTS.find((s) => s.id === message.scriptId) ?? FALLBACK
    const snippet = addSnippet({ title: script.title, tag: script.tag, body: message.text })
    toast({
      title: 'Saved to snippets',
      description: `${snippet.title} · filed under ${snippet.tag}`,
      action: {
        label: 'Open vault',
        onPress: () =>
          navigation.navigate('Tabs', { screen: 'Vault', params: { tool: 'snippets' } }),
      },
    })
  }

  /** A conversation of canned replies is the cheapest record in the app. */
  const clearConversation = () => {
    const previous = messages
    setMessages([])
    toast({
      title: 'Conversation cleared',
      description: `${previous.length} messages`,
      tone: 'danger',
      action: { label: 'Undo', onPress: () => setMessages(previous) },
    })
  }

  return (
    <Screen
      title="Assistant"
      subtitle="Worked examples now. Connect a local model and it both drafts from your own records and acts on them."
      actions={
        messages.length > 0 ? (
          <Button label="Clear" variant="ghost" onPress={clearConversation} />
        ) : undefined
      }
    >
      {/* Stated once, at the top, in the same words the Job scout uses for the
          same fact. The per-reply badge below repeats it because a reply that
          scrolled away from this banner would otherwise read as a real answer. */}
      <Panel>
        {messages.length === 0 ? (
          <EmptyState
            icon="message-square"
            title="Nothing asked yet"
            description="Pick one of the prompts below, or type anything. The replies are written examples — useful to work from, and never presented as a model’s answer."
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
                    Example response · no model connected
                  </Chip>
                  <Txt size="sm" style={{ marginTop: space[2] }}>
                    {m.text}
                  </Txt>
                  <View style={styles.replyActions}>
                    <Button
                      label={isCopied(m.id) ? 'Copied' : 'Copy'}
                      icon={isCopied(m.id) ? 'check' : 'copy'}
                      variant="ghost"
                      onPress={() => copy(m.text, m.id)}
                    />
                    <Button
                      label="Save to snippets"
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
                label={s.action}
                variant="outline"
                size="sm"
                onPress={() => {
                  send(s.action)
                }}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Ask about a cover letter, a follow-up email, an interview…"
            placeholderTextColor={c.text3}
            accessibilityLabel="Ask the assistant"
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
            label="Send"
            disabled={!prompt.trim()}
            onPress={() => {
              send(prompt)
            }}
          />
        </View>
      </Panel>

      <Txt size="sm" tone="secondary">
        With a model connected each of these reads your profile and documents as context. Because
        inference is local, your CV and your notes are never uploaded anywhere.
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
