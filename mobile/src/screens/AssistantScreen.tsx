import { useRef, useState } from 'react'
import { useModelSettings } from '@/lib/model-settings-context'
import { complete, isConfigured } from '@/lib/llm'
import { StyleSheet, TextInput, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Screen } from '@/components/ui/Screen'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import type { SnippetTag } from '@jojo/service/data/vault'
import { useVault } from '@/lib/store-context'
import { useCopy } from '@/lib/use-copy'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
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

/**
 * What the model is told it is. Short on purpose: a long persona spends the
 * context window on itself, and this app's job is the user's own words back in
 * a usable shape rather than a voice.
 */
const SYSTEM_PROMPT =
  'You help someone manage a job search. Answer in plain prose, ready to paste into an email or a form. No preamble, no markdown headings, no offers to help further.'

/** The last few turns, so a follow-up means something. */
const history = (messages: readonly Message[]) =>
  messages.slice(-6).map((m) => ({
    role: m.role === 'you' ? ('user' as const) : ('assistant' as const),
    content: m.text,
  }))

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
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState('')
  const [pending, setPending] = useState(false)
  const { settings } = useModelSettings()
  const connected = isConfigured(settings)
  const nextId = useRef(0)
  const { copy, isCopied } = useCopy()

  const { addSnippet } = useVault()
  const { toast } = useToast()

  /**
   * Two paths, and which one ran is always visible on the reply.
   *
   * With a model configured this is a real request to it. Without one — or when
   * the request fails — it falls back to the worked example, carrying the badge
   * that has been on every canned reply since the first build. What it must
   * never do is present the fallback as a model's answer, which is why the
   * failure case says what failed rather than quietly substituting.
   */
  const send = async (text: string) => {
    const clean = text.trim()
    if (!clean || pending) return
    const at = nextId.current
    nextId.current += 2
    setPrompt('')

    if (!isConfigured(settings)) {
      const script = scriptFor(clean)
      setMessages((prev) => [
        ...prev,
        { id: `m${at}`, role: 'you', text: clean },
        { id: `m${at + 1}`, role: 'assistant', text: script.reply, scriptId: script.id },
      ])
      return
    }

    setMessages((prev) => [...prev, { id: `m${at}`, role: 'you', text: clean }])
    setPending(true)
    const result = await complete(settings, [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history(messages),
      { role: 'user', content: clean },
    ])
    setPending(false)

    setMessages((prev) => [
      ...prev,
      result.ok
        ? { id: `m${at + 1}`, role: 'assistant', text: result.text }
        : {
            id: `m${at + 1}`,
            role: 'assistant',
            text: result.reason,
            failed: true,
          },
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
      subtitle="Worked examples now. Connect a local model and it drafts from your own records."
      actions={
        messages.length > 0 ? (
          <Button label="Clear" variant="ghost" onPress={clearConversation} />
        ) : undefined
      }
    >
      {/* Stated once, at the top, in the same words the Job scout uses for the
          same fact. The per-reply badge below repeats it because a reply that
          scrolled away from this banner would otherwise read as a real answer. */}
      {connected ? (
        <View style={[s.banner, { backgroundColor: c.well, borderColor: c.hairline }]}>
          <Txt size="sm" tone="secondary">
            Answering with{' '}
            <Txt size="sm" weight="medium" mono>
              {settings.model}
            </Txt>{' '}
            at {settings.endpoint}. The request goes to that address and nowhere else.
          </Txt>
        </View>
      ) : (
        <View
          accessibilityRole="alert"
          style={[s.banner, { backgroundColor: c.warningSoft, borderColor: c.warningBorder }]}
        >
          <Txt size="sm" tone="warning">
            No model is connected, so every reply below is a worked example rather than an answer.
            Point jojo at a local OpenAI-compatible server — vLLM, Ollama or LM Studio — in
            Settings.
          </Txt>
        </View>
      )}

      <Panel>
        {messages.length === 0 ? (
          <EmptyState
            icon="message-square"
            title="Nothing asked yet"
            description={
              connected
                ? 'Pick one of the prompts below, or type anything. It answers on your own device, against the model you connected.'
                : "Pick one of the prompts below, or type anything. The replies are written examples — useful to work from, and never presented as a model's answer."
            }
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
                  {/* Not optional, and not a call site's decision — every
                      assistant message renders through this branch. */}
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

        <View style={styles.composer}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Ask about a cover letter, a follow-up email, an interview…"
            placeholderTextColor={c.text3}
            accessibilityLabel="Ask the assistant"
            returnKeyType="send"
            onSubmitEditing={() => send(prompt)}
            style={[
              styles.input,
              { color: c.text1, backgroundColor: c.well, borderColor: c.hairlineStrong },
            ]}
          />
          <IconButton
            icon="arrow-up"
            label="Send"
            disabled={!prompt.trim()}
            onPress={() => send(prompt)}
          />
        </View>
      </Panel>

      <Panel>
        <PanelTitle hint="each one answers with an example">Try one of these</PanelTitle>
        <View style={styles.prompts}>
          {SCRIPTS.map((s) => (
            <Button key={s.id} label={s.action} variant="outline" onPress={() => send(s.action)} />
          ))}
        </View>
        <Txt size="sm" tone="secondary" style={{ marginTop: space[4] }}>
          With a model connected each of these reads your profile and documents as context. Because
          inference would be local, your CV and your notes are never uploaded anywhere.
        </Txt>
      </Panel>
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
