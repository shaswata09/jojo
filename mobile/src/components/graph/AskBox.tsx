import { useCallback, useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useAgent } from '@jojo/service/react/use-agent'
import type { GraphQueryResult } from '@jojo/service/agent/graph-query'
import { agentTurn, isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { Button, IconButton } from '@/components/ui/Button'
import { Txt } from '@/components/ui/Text'
import { StepRow } from '@/components/assistant/AgentTrace'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * Ask the graph in a sentence.
 *
 * The web copy of this carries the argument for the design — the model writes a
 * QUERY, not an answer, so there is no string to parse and the worst a bad
 * generation can do is fail the schema and be told why. What differs here is
 * only what a phone forces: no suggestion chips beside the field (they would
 * push the canvas off screen), and the trace collapsed to the rows themselves.
 *
 * Two tools, not sixty-seven: `graph.query` and `memory.search`, the second
 * because half these questions name a record and a name has to become something
 * the query can hold.
 */
const TOOLS = ['graph.query', 'memory.search'] as const

const SUGGESTIONS = [
  'Which applications have no follow-up scheduled?',
  'Which files are filed under nothing?',
]

export function AskBox({
  onAnswer,
  onClear,
}: {
  onAnswer: (answer: GraphQueryResult, asked: string) => void
  onClear: () => void
}) {
  const c = useColors()
  const { settings } = useModelSettings()
  const connected = isConfigured(settings)
  const [prompt, setPrompt] = useState('')

  const llm = useCallback(
    (messages: Parameters<typeof agentTurn>[1], tools: Parameters<typeof agentTurn>[2]) =>
      agentTurn(settings, messages, tools),
    [settings],
  )

  // Four rounds is generous for two tools: find a name, ask, answer.
  const { entries, busy, send, stop, clear } = useAgent({ llm, tools: TOOLS, maxSteps: 4 })

  const answered = entries
    .filter((e) => e.kind === 'step' && e.step.name === 'graph.query' && e.step.status === 'done')
    .at(-1)
  const asked = entries.filter((e) => e.kind === 'you').at(-1)
  const answeredId = answered?.kind === 'step' ? answered.step.id : null

  /*
   * Lift the answer once per step, not once per render.
   *
   * Keyed on the step's id, which is stable across the running and settled
   * emissions, so this fires on the settle and not again on an unrelated
   * keystroke.
   */
  useEffect(() => {
    if (answered?.kind !== 'step' || !answered.step.output) return
    onAnswer(answered.step.output as GraphQueryResult, asked?.kind === 'you' ? asked.text : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredId])

  const submit = () => {
    const clean = prompt.trim()
    if (!clean || busy) return
    setPrompt('')
    void send(clean)
  }

  if (!connected) {
    return (
      <View
        style={{
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: c.hairline,
          borderRadius: radius.lg,
          padding: space[3],
        }}
      >
        <Txt size="xs" tone="muted">
          Connect a local model in Settings and you can ask this in a sentence. The questions below
          work either way.
        </Txt>
      </View>
    )
  }

  return (
    <View style={{ gap: space[2] }}>
      <View style={[s.row, { gap: space[2] }]}>
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder="Which applications have no follow-up?"
          placeholderTextColor={c.text3}
          accessibilityLabel="Ask the graph a question"
          returnKeyType="search"
          editable={!busy}
          onSubmitEditing={submit}
          style={{
            flex: 1,
            minHeight: 44,
            borderWidth: 1,
            borderRadius: radius.md,
            paddingHorizontal: space[3],
            color: busy ? c.text3 : c.text1,
            backgroundColor: c.well,
            borderColor: c.hairlineStrong,
          }}
        />
        {busy ? (
          <Button label="Stop" variant="outline" onPress={stop} />
        ) : (
          <IconButton icon="arrow-up" label="Ask" disabled={!prompt.trim()} onPress={submit} />
        )}
      </View>

      {entries.length === 0 ? (
        <View style={s.chipRow}>
          {SUGGESTIONS.map((q) => (
            <Button
              key={q}
              label={q}
              variant="outline"
              onPress={() => {
                void send(q)
              }}
            />
          ))}
        </View>
      ) : (
        <View style={{ gap: space[2] }}>
          {/* The trace, in the card. Every tool it ran, in order — the same rows
              the Assistant shows, because it is the same information. */}
          {entries.map((entry) =>
            entry.kind === 'step' ? (
              <StepRow key={entry.id} step={entry.step} />
            ) : entry.kind === 'answer' ? (
              <Txt key={entry.id} size="sm">
                {entry.text}
              </Txt>
            ) : entry.kind === 'error' ? (
              <Txt key={entry.id} size="xs" tone="danger">
                {entry.text}
              </Txt>
            ) : entry.kind === 'note' ? (
              <Txt key={entry.id} size="xs" tone="muted" style={{ fontStyle: 'italic' }}>
                {entry.text}
              </Txt>
            ) : null,
          )}
          <Button
            label="Ask something else"
            variant="ghost"
            onPress={() => {
              clear()
              onClear()
            }}
          />
        </View>
      )}
    </View>
  )
}
