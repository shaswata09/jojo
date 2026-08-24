import { StyleSheet, View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { CATALOG } from '@jojo/service/agent/catalog'
import { Button } from '@/components/ui/Button'
import { Columns } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'

/**
 * What the assistant can do to your records, and what stops it.
 *
 * The audience is somebody deciding whether to let a model write to a year of
 * job applications. That is a trust question rather than a curiosity one, so
 * the order is: what it can do, what it cannot, how it is stopped, and only
 * then the mechanism that makes the prompt small.
 *
 * The two figures answer the two questions that reliably get asked in the wrong
 * order. People ask "how does it pick the right tool" first, and the answer only
 * means anything once they know that picking wrong is caught — so the gate comes
 * before the dependency figure, even though the code runs them the other way
 * round.
 *
 * THE FIGURES ARE VIEWS, NOT SVG, and that is a decision rather than a
 * limitation: `react-native-svg` is already here for the donut, the radar and
 * the graph. The web page draws both as a 420-unit-wide viewBox with 10 and 11
 * point type in it. Scaled into a 390pt phone that is text under 9pt, fixed at
 * that size whatever the reader has asked their device for — a picture whose
 * whole content is words, rendered too small to read. Boxes and rules made of
 * `View` carry the identical structure at the app's own type scale, wrap
 * properly, and answer Dynamic Type. What the SVG has that this does not is
 * exact geometry, and none of the meaning here lives in the geometry.
 *
 * The tool COUNT is read from the catalog rather than typed. It was 82 when this
 * was written, it will not stay 82, and a number in prose that quietly stops
 * matching the software is the failure this whole page argues the app avoids.
 */

export function GuideTools() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const reads = CATALOG.filter((e) => e.effect === 'read').length
  const destructive = CATALOG.filter((e) => e.destructive).length
  const writes = CATALOG.length - reads

  return (
    <>
      <Panel>
        <PanelTitle hint={`${String(CATALOG.length)} in total`}>
          What the assistant can do
        </PanelTitle>
        <Txt size="sm" tone="secondary">
          The assistant does not tap your screens for you. It calls the same {CATALOG.length}{' '}
          operations the buttons call — the identical code path, with the identical checks. There is
          no second way in, which is why an assistant edit lands in your history looking exactly
          like one you made yourself.
        </Txt>

        <View style={{ marginTop: space[3], gap: space[2] }}>
          <Stat n={reads} label="ways to look" hint="reading never changes anything" />
          <Stat n={writes} label="ways to change" hint="every one of them undoable…" />
          <Stat n={destructive} label="marked destructive" hint="…except two, which ask first" />
        </View>

        <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
          Two of those {destructive} cannot be undone at all — the ones that replace or empty the
          whole store. Those are never offered to the assistant unless your own words ask for them,
          and they stop for a confirmation even then.
        </Txt>
        <Button
          label="Open the assistant"
          icon="message-square"
          variant="outline"
          onPress={() => navigation.navigate('Assistant')}
          style={{ marginTop: space[3], alignSelf: 'flex-start' }}
        />
      </Panel>

      <Columns>
        <Panel>
          <PanelTitle hint="the part that actually holds">
            What stops the wrong one running
          </PanelTitle>
          <Txt size="sm" tone="secondary">
            A language model can ask for anything. It can name a tool it was never shown, or invent
            one that does not exist — smaller models do this regularly, and it is not a sign that
            something has gone wrong. So jojo does not rely on the model being careful.
          </Txt>

          <ToolGateFigure total={CATALOG.length} />

          <Txt size="sm" weight="medium" style={{ marginTop: space[4] }}>
            The distinction that matters
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[1.5] }}>
            Choosing what to show the model is a hint. Checking what it actually called is a rule.
            jojo does both, and only the second one is load-bearing: a call to something outside the
            offered set is refused before anything is looked up, let alone run. The model is told
            the name is unavailable, in the same words it gets for a name that does not exist, and
            it moves on.
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
            This is why the Graph screen&apos;s &ldquo;Ask the graph&rdquo; box can safely offer two
            read-only tools. It is not trusting the model to stay within them.
          </Txt>
        </Panel>

        <Panel>
          <PanelTitle hint="so a request never stops halfway">
            How it picks the right one
          </PanelTitle>
          <Txt size="sm" tone="secondary">
            Showing a model all {CATALOG.length} tools at once costs about fifteen thousand words of
            the space it has to think in — before you have typed anything. On a small model running
            on your own machine, that can be more space than it has. So jojo narrows the list to
            what your words point at.
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
            Narrowing carelessly is worse than not narrowing. Most operations need something to act
            on: you cannot attach a keyword without a keyword, or update a document without a
            document. Hide the tool that makes the thing, and the assistant stops halfway with
            nothing on screen explaining why.
          </Txt>

          <ToolGraphFigure />

          <Txt size="sm" weight="medium" style={{ marginTop: space[4] }}>
            When it is not sure, it does not narrow
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[1.5] }}>
            &ldquo;Remind me about Baylor on Thursday&rdquo; is clear, and jojo offers about a fifth
            of the catalog. &ldquo;Actually, that was the other one&rdquo; is not clear about
            anything — so it offers everything, exactly as it would have before any of this existed.
            Being unsure costs a little speed. Guessing would cost you your answer.
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
            A conversation only ever gains tools. Nothing you have already used is taken away by a
            later question.
          </Txt>
        </Panel>

        <Panel>
          <PanelTitle hint="your choice, and it changes where your words go">
            Which model does this
          </PanelTitle>
          <Txt size="sm" tone="secondary">
            jojo talks to whatever you point it at in Settings. A model running on a machine you
            control — Ollama, vLLM, LM Studio — is the default, and it is the only arrangement where
            nothing you write leaves this device.
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
            You can also use Claude, OpenAI and others with an API key. That is a real trade and the
            screen says so plainly: your records go to that company and are billed to your account.
            The key is kept on this device, is never included in a backup, and is never sent
            anywhere but the provider you chose.
          </Txt>
          <Button
            label="Open Settings"
            icon="settings"
            variant="outline"
            onPress={() => navigation.navigate('Settings')}
            style={{ marginTop: space[3], alignSelf: 'flex-start' }}
          />

          <Txt size="sm" weight="medium" style={{ marginTop: space[4] }}>
            If the assistant seems to have stopped reading
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[1.5] }}>
            A local model with too little room silently drops the front of what it was sent, and
            then answers confidently about a question it never fully saw. jojo compares what the
            server says it read against what was actually sent, and tells you when the two disagree
            — because the alternative is an assistant that appears to be bad at its job rather than
            short of room.
          </Txt>
        </Panel>
      </Columns>
    </>
  )
}

/* --------------------------------- stats ---------------------------------- */

/** One number and what it counts, in the three-across shape the web page uses. */
function Stat({ n, label, hint }: { n: number; label: string; hint: string }) {
  const c = useColors()
  return (
    <View style={[styles.stat, { backgroundColor: c.well, borderColor: c.hairline }]}>
      {/* Mono, so three numbers of different widths still line up down the
          column. The web gets the same from its `tabular` utility. */}
      <Txt size="lg" weight="medium" mono style={styles.statNumber}>
        {n}
      </Txt>
      <View style={s.fill}>
        <Txt size="sm">{label}</Txt>
        <Txt size="xs" tone="muted" style={{ marginTop: 1 }}>
          {hint}
        </Txt>
      </View>
    </View>
  )
}

/* ------------------------------- the gates -------------------------------- */

/**
 * The path a request takes, and the two places it can be stopped.
 *
 * This figure carries the distinction people get wrong about every system like
 * this: choosing what to OFFER is a hint, and checking what was CALLED is a
 * rule. A model can emit any name it likes regardless of what it was shown, so a
 * design that only narrows the list has narrowed nothing that matters.
 *
 * Both gates are drawn, in the order they act, with the second marked as the one
 * that actually holds. Top to bottom, because this genuinely is a sequence and
 * the order is the content.
 *
 * A `note` is an exit rather than a step: neither of them continues down the
 * column. The web draws them as dashed branches off to the right, which is a
 * shape a 390pt screen does not have room for — so they sit under their own step,
 * indented, behind the arrow that means "and this way out".
 */
type GateTone = 'plain' | 'gate' | 'stop'

function ToolGateFigure({ total }: { total: number }) {
  const c = useColors()

  const steps: { label: string; tone: GateTone; note?: string }[] = [
    { label: 'what you typed', tone: 'plain' },
    { label: 'pick the likely tools', tone: 'gate', note: `unclear? offer all ${String(total)}` },
    { label: 'add what those tools need', tone: 'plain', note: 'so no chain dead-ends' },
    { label: 'the model chooses one', tone: 'plain' },
    { label: 'was it offered?', tone: 'stop', note: 'no? refused, nothing runs' },
    { label: 'your records change', tone: 'plain' },
  ]

  const ink: Record<GateTone, string> = {
    plain: c.hairlineStrong,
    gate: c.accentBorder,
    stop: c.dangerBorder,
  }

  return (
    <View style={{ marginTop: space[4] }}>
      {/*
        One node to a screen reader, which is what the web figure's `role="img"`
        and its `<desc>` buy there. Read row by row this is eleven fragments in
        an order that only makes sense visually.
      */}
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          'Six steps, top to bottom. One, what you typed. Two, jojo picks the tools your words ' +
          `point at — and if your words are unclear it offers all ${String(total)} rather than ` +
          'guessing. Three, it adds whatever those tools depend on, so no chain can dead-end. ' +
          'Four, the model chooses one tool. Five, jojo checks whether that tool was actually ' +
          'offered; if it was not, the call is refused and nothing runs. Six, only then do your ' +
          'records change. The fifth step is the one that enforces anything — the second is only ' +
          'a hint, because a model can name a tool it was never shown.'
        }
      >
        {steps.map((step, i) => (
          <View key={step.label}>
            <View
              style={[
                styles.gateStep,
                {
                  backgroundColor: c.well,
                  borderColor: ink[step.tone],
                  borderWidth: step.tone === 'plain' ? StyleSheet.hairlineWidth : 1.5,
                },
              ]}
            >
              <Txt size="sm">{step.label}</Txt>
            </View>

            {step.note ? (
              <View style={[s.row, styles.gateNote]}>
                <Feather name="corner-down-right" size={14} color={ink[step.tone]} />
                <Txt size="xs" tone="secondary" style={s.fill}>
                  {step.note}
                </Txt>
              </View>
            ) : null}

            {i < steps.length - 1 ? (
              <View style={styles.gateArrow}>
                <Feather name="chevron-down" size={16} color={c.hairlineStrong} />
              </View>
            ) : null}
          </View>
        ))}
      </View>

      <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
        Step two saves you tokens. Step five is the one that keeps you safe — and it runs whether or
        not step two narrowed anything.
      </Txt>
    </View>
  )
}

/* ----------------------------- the tool graph ----------------------------- */

/**
 * Why the assistant is never offered a tool it cannot finish using.
 *
 * `keyword.attach` is the right first example because the dependency is
 * invisible in the name. Nothing about "attach a keyword" says it needs a
 * keyword that already exists, and a person reading the tool list would not spot
 * it either — which is exactly why the app derives the answer from the schema
 * rather than asking anybody to remember it.
 *
 * A tool needs an id of some kind; something else makes ids of that kind; so the
 * second is pulled in behind the first, automatically, every time. The web draws
 * each row left to right, because this is a dependency and not a sequence and a
 * vertical stack would imply an order that does not exist. At 390pt there is no
 * left-to-right to be had: two monospaced tool names and a phrase between them
 * do not share a line. So the rows stack, and the ORDER is disowned in the
 * caption above them instead — each block is one dependency, not step one of
 * three.
 */
const PULLS: { asked: string; needs: string; pulled: string }[] = [
  { asked: 'keyword.attach', needs: 'a keyword', pulled: 'keyword.create' },
  { asked: 'vault.file.update', needs: 'a file', pulled: 'vault.file.add' },
  { asked: 'scout.posting.promote', needs: 'a posting', pulled: 'scout.posting.save' },
]

function ToolGraphFigure() {
  const c = useColors()

  return (
    <View style={{ marginTop: space[4] }}>
      <Txt size="xs" tone="muted">
        Three examples, in no order. Each is one tool your words asked for, what it cannot run
        without, and the tool jojo offers alongside it so the chain can finish.
      </Txt>

      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          'Three examples. Asking for keyword.attach also offers keyword.create, because ' +
          'attaching a keyword needs a keyword that already exists. Asking for ' +
          'vault.file.update also offers vault.file.add, because updating a document needs a ' +
          'document. Asking for scout.posting.promote also offers scout.posting.save, because ' +
          'promoting a saved posting needs a saved posting. In every case jojo works the ' +
          'dependency out from the tool’s own input, and offers both tools together — so the ' +
          'assistant is never handed a first step with no way to reach the second.'
        }
        style={{ marginTop: space[2] }}
      >
        {PULLS.map((pull, i) => (
          <View key={pull.asked}>
            {i > 0 ? <Divider style={{ marginVertical: space[3] }} /> : null}
            <View
              style={[styles.toolBox, { backgroundColor: c.well, borderColor: c.hairlineStrong }]}
            >
              <Txt size="sm" mono numberOfLines={1}>
                {pull.asked}
              </Txt>
            </View>

            <View style={[s.row, styles.gateNote]}>
              <Feather name="corner-down-right" size={14} color={c.hairlineStrong} />
              <Txt size="xs" tone="secondary" style={s.fill}>
                needs {pull.needs}, so jojo also offers
              </Txt>
            </View>

            <View
              style={[styles.toolBox, { backgroundColor: c.well, borderColor: c.accentBorder }]}
            >
              <Txt size="sm" mono numberOfLines={1}>
                {pull.pulled}
              </Txt>
            </View>
          </View>
        ))}
      </View>

      {/* The counterfactual, said once rather than drawn as a fourth block: a
          broken chain has no picture, which is the problem. */}
      <Txt size="xs" tone="muted" style={{ marginTop: space[3] }}>
        Without this, the assistant could be offered the first tool and not the second — and would
        stop halfway with nothing on screen to say why.
      </Txt>
      <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
        jojo reads each requirement out of the tool&apos;s own definition, so a tool added tomorrow
        is covered without anybody updating a list.
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
  },
  statNumber: { minWidth: 32, textAlign: 'right' },
  gateStep: {
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
  },
  gateNote: { marginTop: space[1.5], paddingLeft: space[3] },
  gateArrow: { alignItems: 'center', paddingVertical: space[1] },
  toolBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
})
