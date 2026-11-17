import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
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
import { Icon } from '@/components/ui/Icon'

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
  const { t } = useTranslation('guide')
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const reads = CATALOG.filter((e) => e.effect === 'read').length
  const destructive = CATALOG.filter((e) => e.destructive).length
  const writes = CATALOG.length - reads

  return (
    <>
      <Panel>
        <PanelTitle hint={t('tools.inTotal', { count: CATALOG.length })}>
          {t('tools.canDo.title')}
        </PanelTitle>
        <Txt size="sm" tone="secondary">
          {t('tools.canDo.body', { count: CATALOG.length })}
        </Txt>

        <View style={{ marginTop: space[3], gap: space[2] }}>
          <Stat
            n={reads}
            label={t('tools.stats.reads.label', { count: reads })}
            hint={t('tools.stats.reads.hint')}
          />
          <Stat
            n={writes}
            label={t('tools.stats.writes.label', { count: writes })}
            hint={t('tools.stats.writes.hint')}
          />
          <Stat
            n={destructive}
            label={t('tools.stats.destructive.label', { count: destructive })}
            hint={t('tools.stats.destructive.hint')}
          />
        </View>

        <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
          {t('tools.canDo.irreversible', { count: destructive })}
        </Txt>
        <Button
          label={t('tools.canDo.open')}
          icon="message-square"
          variant="outline"
          onPress={() => navigation.navigate('Assistant')}
          style={{ marginTop: space[3], alignSelf: 'flex-start' }}
        />
      </Panel>

      <Columns>
        <Panel>
          <PanelTitle hint={t('tools.gate.hint')}>{t('tools.gate.title')}</PanelTitle>
          <Txt size="sm" tone="secondary">
            {t('tools.gate.body')}
          </Txt>

          <ToolGateFigure total={CATALOG.length} />

          <Txt size="sm" weight="medium" style={{ marginTop: space[4] }}>
            {t('tools.gate.distinctionTitle')}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[1.5] }}>
            {t('tools.gate.distinction')}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
            {t('tools.gate.askGraph')}
          </Txt>
        </Panel>

        <Panel>
          <PanelTitle hint={t('tools.pick.hint')}>{t('tools.pick.title')}</PanelTitle>
          <Txt size="sm" tone="secondary">
            {t('tools.pick.cost', { count: CATALOG.length })}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
            {t('tools.pick.careless')}
          </Txt>

          <ToolGraphFigure />

          <Txt size="sm" weight="medium" style={{ marginTop: space[4] }}>
            {t('tools.pick.unsureTitle')}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[1.5] }}>
            {t('tools.pick.unsure')}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
            {t('tools.pick.onlyGains')}
          </Txt>
        </Panel>

        <Panel>
          <PanelTitle hint={t('tools.model.hint')}>{t('tools.model.title')}</PanelTitle>
          <Txt size="sm" tone="secondary">
            {t('tools.model.local')}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[3] }}>
            {t('tools.model.cloud')}
          </Txt>
          <Button
            label={t('tools.model.openSettings')}
            icon="settings"
            variant="outline"
            onPress={() => navigation.navigate('Settings')}
            style={{ marginTop: space[3], alignSelf: 'flex-start' }}
          />

          <Txt size="sm" weight="medium" style={{ marginTop: space[4] }}>
            {t('tools.model.truncatedTitle')}
          </Txt>
          <Txt size="sm" tone="secondary" style={{ marginTop: space[1.5] }}>
            {t('tools.model.truncated')}
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
  const { t } = useTranslation('guide')
  const c = useColors()

  const steps: { label: string; tone: GateTone; note?: string }[] = [
    { label: t('tools.gateFigure.typed'), tone: 'plain' },
    {
      label: t('tools.gateFigure.pick'),
      tone: 'gate',
      note: t('tools.gateFigure.pickNote', { count: total }),
    },
    { label: t('tools.gateFigure.add'), tone: 'plain', note: t('tools.gateFigure.addNote') },
    { label: t('tools.gateFigure.choose'), tone: 'plain' },
    { label: t('tools.gateFigure.offered'), tone: 'stop', note: t('tools.gateFigure.offeredNote') },
    { label: t('tools.gateFigure.change'), tone: 'plain' },
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
        accessibilityLabel={t('tools.gateFigure.description', { count: total })}
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
                <Icon name="corner-down-right" size={14} color={ink[step.tone]} />
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
        {t('tools.gateFigure.caption')}
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
/** Tool names are identifiers and stay as written; `needs` is a key under `tools.graphFigure.needs`. */
const PULLS: { asked: string; needs: string; pulled: string }[] = [
  { asked: 'keyword.attach', needs: 'keyword', pulled: 'keyword.create' },
  { asked: 'vault.file.update', needs: 'file', pulled: 'vault.file.add' },
  { asked: 'scout.posting.promote', needs: 'posting', pulled: 'scout.posting.save' },
]

function ToolGraphFigure() {
  const { t } = useTranslation('guide')
  const c = useColors()

  return (
    <View style={{ marginTop: space[4] }}>
      <Txt size="xs" tone="muted">
        {t('tools.graphFigure.intro')}
      </Txt>

      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('tools.graphFigure.description')}
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
              <Icon name="corner-down-right" size={14} color={c.hairlineStrong} />
              <Txt size="xs" tone="secondary" style={s.fill}>
                {t(`tools.graphFigure.needs.${pull.needs}`)}
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
        {t('tools.graphFigure.without')}
      </Txt>
      <Txt size="xs" tone="muted" style={{ marginTop: space[2] }}>
        {t('tools.graphFigure.derived')}
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
