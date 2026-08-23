import { useCallback, useState } from 'react'
import { fitOf } from '@/lib/fit'
import { listJoin } from '@/lib/text'
import { TODAY } from '@/lib/today'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip, StatusDot } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormField, SettingRow, TextField, Toggle } from '@/components/ui/Field'
import { Screen } from '@/components/ui/Screen'
import { SearchInput } from '@/components/ui/SearchInput'
import { Segment } from '@/components/ui/Segment'
import { Sheet } from '@/components/ui/Sheet'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import type { Pipeline } from '@jojo/service/data/scout'
import { displayName } from '@jojo/service/data/seed'
import { agoLabel } from '@jojo/service/data/timeline'
// The parser is the shared one. `src/lib/draft-from.ts` held a 349-line copy of
// it that was never tested here; the two were checked input for input before it
// was deleted. `scout.posting.promote` parses a posting's URL through this same
// module with no screen in the call stack, so a second copy up here could only
// ever disagree with the store about what a pasted link means.
import { draftFromUrl } from '@jojo/service/core/parse-posting'
import { useProfile } from '@jojo/service/react/use-profile'
import { usePipelines, isAuto, kindOf } from '@jojo/service/react/use-pipelines'
import { AUTO_CAPABLE, PIPELINE_SCHEDULES, scheduleOf } from '@jojo/service/core/proposal'
import type { PipelineKind } from '@jojo/service/core/model'
import { ProposalQueue } from '@/components/scout/ProposalQueue'
import { agentTurn, isConfigured } from '@/lib/llm'
import { scanBoard } from '@/lib/board-scan'
import { useModelSettings } from '@/lib/model-settings-context'
import { useApplications, useScout } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { displayUrl, hrefOf } from '@/lib/urls'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/** Fit bands. A number alone doesn't say whether 64 is good. */
const fitTone = (fit: number) => (fit >= 80 ? 'green' : fit >= 60 ? 'amber' : 'gray')

/*
 * One list, in the shared layer. It was written out here and again in web's
 * PipelineDialog, with a `frequencyOf` on each side to cope with a stored value
 * that matched neither copy — `scheduleOf` is that function, once.
 */
const FREQUENCIES = PIPELINE_SCHEDULES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}))

const KINDS = [
  { value: 'twin', label: 'Keep records complete' },
  { value: 'scout', label: 'Find postings' },
] as const

const KIND_LABEL = { twin: 'Digital twin', scout: 'Job scout' } as const

/** What a row's chip says. Four states, and each is a claim about the world. */
function statusOf(p: Pipeline, running: boolean, paused: boolean) {
  if (!p.enabled) return { label: 'off', tone: 'gray' as const, dot: 'off' as const }
  if (paused) return { label: 'paused', tone: 'amber' as const, dot: 'warn' as const }
  if (running) return { label: 'running', tone: 'teal' as const, dot: 'on' as const }
  return { label: 'watching', tone: 'green' as const, dot: 'on' as const }
}

export function JobScoutScreen() {
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const {
    matches,
    postings,
    addPosting,
    removePosting,
    promoteToApplication,
    promotePosting,
    pipelines,
    addPipeline,
    updatePipeline,
    removePipeline,
  } = useScout()
  const { profile } = useProfile()
  const { get } = useApplications()
  const { toast } = useToast()

  /**
   * The pipelines' engine, identical to web's — the hook is shared and this is
   * the whole of the platform difference: which `agentTurn` it is handed.
   *
   * A pipeline runs while this screen's app is in the FOREGROUND. React Native
   * suspends JavaScript when the app is backgrounded, so there is no honest way
   * to promise otherwise without a background-task module this app does not
   * ship. Everything needed to resume is in the graph, so leaving and coming
   * back picks up where it left off.
   */
  const { settings } = useModelSettings()
  const llm = useCallback(
    (messages: Parameters<typeof agentTurn>[1], tools: Parameters<typeof agentTurn>[2]) =>
      agentTurn(settings, messages, tools),
    [settings],
  )
  // Module scope and therefore stable, which matters: an unstable port would
  // rebuild the agent's host on every render and restart a round mid-flight.
  const engine = usePipelines({ llm: isConfigured(settings) ? llm : null, scan: scanBoard })

  const [editing, setEditing] = useState<Pipeline | 'new' | null>(null)
  const [onlyActive, setOnlyActive] = useState(false)
  const [url, setUrl] = useState('')

  const visiblePipelines = pipelines.filter((p) => !onlyActive || p.enabled)

  const savePipeline = (draft: PipelineDraft) => {
    if (editing && editing !== 'new') {
      updatePipeline(editing.id, draft)
      toast({ title: 'Pipeline updated', description: draft.name })
    } else {
      // Switched on: one that arrived off would read as a create that failed.
      // Whether it can run is the model's business, and the toast says which of
      // the two just happened rather than asserting the pessimistic one.
      const pipeline = addPipeline({ ...draft, enabled: true })
      toast({
        title: 'Pipeline created',
        description: engine.paused
          ? `${pipeline.name} — paused until a model is connected.`
          : `${pipeline.name} — it will start looking shortly.`,
      })
    }
    setEditing(null)
  }

  const onDeletePipeline = (p: Pipeline) => {
    const { restore } = removePipeline(p.id)
    toast({
      title: 'Pipeline deleted',
      description: `${p.name} stops watching ${p.source}.`,
      tone: 'danger',
      action: { label: 'Undo', onPress: restore },
    })
  }

  /** Turns a match into a real application and goes straight to it. */
  const onPromote = (matchId: string) => {
    const application = promoteToApplication(matchId)
    if (!application) return
    toast({
      title: `${application.org} added as a draft`,
      description: 'The match stays in this feed, now linked to the application.',
    })
    navigation.navigate('ApplicationDetail', { id: application.id })
  }

  /**
   * Files the posting. No page is fetched — nothing here can — so the record
   * says what it is: a URL you kept, with the employer guessed off it.
   */
  const onSavePosting = () => {
    const text = url.trim()
    if (!text) return
    const guess = draftFromUrl(text)
    const title = [guess.org, guess.role].filter(Boolean).join(' — ') || text
    addPosting({ title, url: text, size: '—' })
    setUrl('')
    toast({ title: 'Posting saved', description: title })
  }

  const onPromotePosting = (postingId: string) => {
    const application = promotePosting(postingId)
    if (!application) return
    toast({
      title: `${application.org} added as a draft`,
      description: 'The posting stays saved here, now linked to the application.',
    })
    navigation.navigate('ApplicationDetail', { id: application.id })
  }

  const onRemovePosting = (id: string, title: string) => {
    const { restore } = removePosting(id)
    toast({
      title: 'Posting removed',
      description: title,
      tone: 'danger',
      action: { label: 'Undo', onPress: restore },
    })
  }

  return (
    <Screen
      title="Job scout"
      subtitle="Saved searches that will watch job boards for you — and somewhere to park postings today"
      actions={<Button label="New" icon="plus" onPress={() => setEditing('new')} />}
      options={
        <SettingRow
          label="Only active pipelines"
          description="Hide the ones switched off"
          control={
            <Toggle
              value={onlyActive}
              onValueChange={setOnlyActive}
              label="Only active pipelines"
            />
          }
        />
      }
    >
      {/* System status, stated plainly rather than implied by a colour — and
          read off the model settings rather than hardcoded, which is what it
          was while nothing could run either way. */}
      {engine.paused ? (
        <View
          accessibilityRole="alert"
          style={[s.banner, { backgroundColor: c.warningSoft, borderColor: c.warningBorder }]}
        >
          <Txt size="sm" tone="warning">
            No local model is connected, so pipelines are paused. You can still write them and save
            postings below — they start running once a model is reachable.
          </Txt>
        </View>
      ) : null}

      <Panel>
        <PanelTitle hint="run locally on a schedule">Pipelines</PanelTitle>

        {visiblePipelines.length === 0 ? (
          <EmptyState
            icon="radio"
            title={onlyActive ? 'Nothing switched on' : 'No pipelines'}
            description={
              onlyActive
                ? 'Every pipeline you have is switched off. Turn one on, or drop the filter in the page options.'
                : 'A pipeline is a saved search — a board to watch, the terms that matter, and how often to look.'
            }
            action={
              onlyActive ? (
                <Button
                  label="Show all pipelines"
                  variant="outline"
                  onPress={() => setOnlyActive(false)}
                />
              ) : (
                <Button label="New pipeline" icon="plus" onPress={() => setEditing('new')} />
              )
            }
          />
        ) : (
          visiblePipelines.map((p, i) => {
            const isRunning = engine.running === p.id
            const state = statusOf(p, isRunning, engine.paused)
            const pending = engine.pendingFor(p.id).length
            const kind = kindOf(p)

            return (
              <View key={p.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <View style={{ marginTop: 5 }}>
                    <StatusDot status={state.dot} />
                  </View>
                  <View style={s.fill}>
                    <Txt size="sm" weight="medium">
                      {p.name}
                    </Txt>
                    {/* While it is running, the model's own narration replaces
                        the configuration line — during the one moment the row
                        could say something specific, "daily · —" is a waste of
                        the only line there is. */}
                    <Txt size="xs" tone="muted" mono numberOfLines={2}>
                      {isRunning && engine.activity
                        ? engine.activity
                        : `${p.source} · ${p.schedule} · ${p.filter}`}
                    </Txt>
                    <View
                      style={{
                        marginTop: space[1.5],
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: space[1.5],
                      }}
                    >
                      <Chip tone="gray" size="sm">
                        {KIND_LABEL[kind]}
                      </Chip>
                      <Chip tone={state.tone} size="sm">
                        {state.label}
                      </Chip>
                      {pending > 0 ? (
                        <Chip tone="teal" size="sm">
                          {`${String(pending)} to review`}
                        </Chip>
                      ) : null}
                      {isAuto(p) ? (
                        <Chip tone="amber" size="sm">
                          auto
                        </Chip>
                      ) : null}
                    </View>
                    {/* Auto is offered only where it exists. A scout never runs
                        unattended — see AUTO_CAPABLE — so a disabled switch
                        would advertise a setting that is not coming. */}
                    {AUTO_CAPABLE[kind] ? (
                      <View style={{ marginTop: space[2] }}>
                        <SettingRow
                          label="Run without asking"
                          description="Apply what it finds and just tell you afterwards."
                          control={
                            <Toggle
                              value={isAuto(p)}
                              onValueChange={(auto) => engine.setAuto(p, auto)}
                              label={`Run ${p.name} without asking`}
                            />
                          }
                        />
                      </View>
                    ) : null}
                  </View>
                  <Toggle
                    value={p.enabled}
                    onValueChange={(enabled) => engine.setEnabled(p, enabled)}
                    label={`Enable ${p.name}`}
                  />
                  <IconButton
                    icon="play"
                    label={`Run ${p.name} now`}
                    disabled={engine.paused || engine.running !== null}
                    onPress={() => engine.runNow(p.id)}
                  />
                  <IconButton icon="edit-2" label={`Edit ${p.name}`} onPress={() => setEditing(p)} />
                  <IconButton
                    icon="trash-2"
                    tone="danger"
                    label={`Delete ${p.name}`}
                    onPress={() => onDeletePipeline(p)}
                  />
                </View>
              </View>
            )
          })
        )}
      </Panel>

      {/* Above the matches and the postings: it is the only panel on the
          screen that is asking the reader for something. */}
      <ProposalQueue
        proposals={engine.proposals}
        pipelines={engine.pipelines}
        onApprove={engine.approve}
        onDiscard={engine.discard}
        onSweep={engine.sweep}
      />

      <Panel>
        {/* The hint used to read "example scores", because the percentages were
            fixtures. They are computed now — against the match terms, target
            roles and regions on your profile — so the hint says what they are
            measured against rather than apologising for them. */}
        <PanelTitle hint="scored against your profile">Matches</PanelTitle>

        {matches.length === 0 ? (
          <EmptyState
            icon="radio"
            title="No matches"
            description="Pipelines put scored postings here once a model is connected. Until then, the postings you save below are the way in."
          />
        ) : (
          matches.map((m, i) => {
            // The edge is cleared when an application is deleted, so a match can
            // carry an id whose record has just gone; read it, never assume it.
            const application = m.applicationId ? get(m.applicationId) : undefined
            const fit = fitOf(profile, m.role, m.detail)
            return (
              <View key={m.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.matchRow}>
                  <View style={s.fill}>
                    <Txt size="sm">{m.role}</Txt>
                    <Txt size="xs" tone="muted">
                      {m.detail}
                    </Txt>
                    {/* What it matched on, so a percentage is a claim you can
                        check rather than a number to be trusted. */}
                    {fit.matched.length > 0 ? (
                      <Txt size="xs" tone="muted" numberOfLines={1}>
                        matched {listJoin(fit.matched.slice(0, 3))}
                      </Txt>
                    ) : null}
                    {fit.score === null ? (
                      <Txt size="xs" tone="muted">
                        {fit.reason}
                      </Txt>
                    ) : null}
                    {application ? (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() =>
                          navigation.navigate('ApplicationDetail', { id: application.id })
                        }
                      >
                        <Txt size="xs" tone="info" style={{ marginTop: space[1] }}>
                          In applications as {displayName(application)}
                        </Txt>
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={styles.matchRight}>
                    {/* No score rather than a made-up one. An empty profile has
                        told the app nothing to rank against, and a confident
                        number over nothing is what the fixtures used to do. */}
                    {fit.score === null ? (
                      <Chip tone="gray" size="sm">
                        not scored
                      </Chip>
                    ) : (
                      <Chip tone={fitTone(fit.score)} size="sm">{`${fit.score}% fit`}</Chip>
                    )}
                    {/* Promoting links the two rather than moving the match: the
                        feed is generated, so a mis-tap on a row that vanished
                        could not be undone. */}
                    {application ? (
                      <Chip tone="teal" size="sm">
                        added
                      </Chip>
                    ) : (
                      <Button label="Add" variant="outline" onPress={() => onPromote(m.id)} />
                    )}
                  </View>
                </View>
              </View>
            )
          })
        )}
      </Panel>

      <Panel>
        <PanelTitle hint="works without a model">Save a posting</PanelTitle>
        <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
          Nothing here fetches the page, so what is kept is the URL, the employer guessed from it,
          and the day you saved it — enough to find the ad again, and to apply from.
        </Txt>

        <View style={{ gap: space[2] }}>
          <SearchInput
            label="Job posting URL"
            value={url}
            onChange={setUrl}
            placeholder="https://university.edu/careers/…"
          />
          <Button
            label="Save posting"
            size="md"
            blocker={url.trim() ? undefined : 'Paste a URL first'}
            onPress={onSavePosting}
          />
        </View>

        <View style={{ marginTop: space[4] }}>
          {postings.length === 0 ? (
            <EmptyState
              icon="external-link"
              title="No postings saved"
              description="Paste the URL of an ad you want to come back to. Ads are taken down; the link and the date are yours."
            />
          ) : (
            postings.map((p, i) => {
              const application = p.applicationId ? get(p.applicationId) : undefined
              return (
                <View key={p.id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.matchRow}>
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => Linking.openURL(hrefOf(p.url))}
                      style={s.fill}
                    >
                      <Txt size="sm" numberOfLines={2}>
                        {p.title}
                      </Txt>
                      {/* The seed carries a page size for pages that were never
                          fetched. Printing it would restate the very claim the
                          disabled snapshot button denies. */}
                      <Txt size="xs" tone="muted" mono numberOfLines={1}>
                        {displayUrl(p.url)} · saved {agoLabel(p.savedOn, TODAY)}
                      </Txt>
                      {application ? (
                        <Txt size="xs" tone="info" style={{ marginTop: space[1] }}>
                          In applications as {displayName(application)}
                        </Txt>
                      ) : null}
                      <View style={{ marginTop: space[1.5] }}>
                        <Chip tone={p.linked ? 'teal' : 'gray'} size="sm">
                          {p.linked ? 'linked to application' : 'unscored'}
                        </Chip>
                      </View>
                    </Pressable>
                    <View style={styles.matchRight}>
                      {p.linked ? null : (
                        <Button
                          label="Add"
                          variant="outline"
                          onPress={() => onPromotePosting(p.id)}
                        />
                      )}
                      <IconButton
                        icon="trash-2"
                        tone="danger"
                        label={`Remove ${p.title}`}
                        onPress={() => onRemovePosting(p.id, p.title)}
                      />
                    </View>
                  </View>
                </View>
              )
            })
          )}
        </View>
      </Panel>

      <Txt size="xs" tone="muted">
        Pipelines run on your device, while jojo is open. Nothing is sent to a third party.
      </Txt>

      {/*
       * Asked when a pipeline has run twice with nothing to show for it.
       * "Keep it running" is not a no-op — it resets the idle counter, so the
       * question cannot come straight back on the next round.
       */}
      <Sheet
        open={engine.shutdownOffer !== null}
        onClose={engine.dismissShutdown}
        title={`Switch off ${engine.shutdownOffer?.name ?? ''}?`}
        description="It has run twice without finding anything to suggest, and there is nothing waiting for you to answer. Switching it off stops it looking; everything it has already found stays where it is."
        footer={
          <>
            <Button label="Keep it running" variant="ghost" size="md" onPress={engine.dismissShutdown} />
            <Button label="Switch it off" size="md" onPress={engine.acceptShutdown} />
          </>
        }
      >
        <View />
      </Sheet>

      {editing ? (
        <PipelineEditor
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={savePipeline}
        />
      ) : null}
    </Screen>
  )
}

/** What the form collects. The run-state fields belong to the runner. */
type PipelineDraft = {
  name: string
  source: string
  schedule: string
  filter: string
  kind: PipelineKind
}

function PipelineEditor({
  initial,
  onClose,
  onSave,
}: {
  initial?: Pipeline
  onClose: () => void
  onSave: (draft: PipelineDraft) => void
}) {
  const [kind, setKind] = useState<PipelineKind>(initial?.kind ?? 'scout')
  const [name, setName] = useState(initial?.name ?? '')
  const [source, setSource] = useState(initial?.source === '—' ? '' : (initial?.source ?? ''))
  const [terms, setTerms] = useState(initial?.filter === '—' ? '' : (initial?.filter ?? ''))
  const [schedule, setSchedule] = useState(scheduleOf(initial?.schedule ?? 'daily'))
  // Raised by a save attempt rather than by typing, so an untouched field is not
  // marked wrong before anyone has reached it.
  const [attempted, setAttempted] = useState(false)

  /*
   * A twin reads the records it already has, so it has no source to name and
   * the field would be a question with no answer. The scout keeps the
   * requirement it always had.
   */
  const needsSource = kind === 'scout'

  const submit = () => {
    setAttempted(true)
    if (!name.trim() || (needsSource && !source.trim())) return
    onSave({
      name: name.trim(),
      // The seed writes an em dash where a pipeline has nothing to say in a
      // field, and the row prints these verbatim — an empty string leaves a
      // dangling separator in the middle of the line.
      source: source.trim() || '—',
      schedule,
      filter: terms.trim() || '—',
      kind,
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Edit pipeline' : 'New pipeline'}
      description="A pipeline is a standing job for the assistant. It runs on this device while jojo is open, and everything it wants to change is shown to you first."
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
          <Button label={initial ? 'Save' : 'Create'} size="md" onPress={submit} />
        </>
      }
    >
      <View style={{ gap: space[3.5], paddingBottom: space[2] }}>
        {/* Only when creating. A pipeline's kind decides which agent runs and
            which tools it may reach, so changing it under a queue raised by the
            other one would leave suggestions whose rules no longer match their
            pipeline. `scout.pipeline.update` refuses it for the same reason. */}
        {initial ? null : (
          <FormField
            label="What it does"
            hint={
              kind === 'twin'
                ? 'Reads what you have and suggests what is missing — notes, reminders, tags, filing.'
                : 'Looks for postings worth your attention and puts them up for review.'
            }
          >
            <Segment label="What it does" options={KINDS} value={kind} onChange={setKind} />
          </FormField>
        )}
        <TextField
          label="Name"
          required
          value={name}
          error={attempted && !name.trim() ? 'Name it after what it watches.' : undefined}
          placeholder={kind === 'twin' ? 'e.g. Keep my applications tidy' : 'e.g. CRA faculty job board'}
          onChangeText={setName}
        />
        {needsSource ? (
          <TextField
            label="Sources"
            required
            mono
            autoCapitalize="none"
            value={source}
            error={
              attempted && !source.trim() ? 'A scout with no source has nothing to read.' : undefined
            }
            hint="The board or careers page it watches. Separate several with commas."
            placeholder="cra.org/ads"
            onChangeText={setSource}
          />
        ) : null}
        <TextField
          label={kind === 'twin' ? 'What to focus on' : 'Match terms'}
          value={terms}
          hint={
            kind === 'twin'
              ? 'Anything it should pay particular attention to. Leave blank to let it look everywhere.'
              : 'What a posting is scored against. Leave blank to keep everything the source lists.'
          }
          placeholder={kind === 'twin' ? 'follow-ups and deadlines' : 'assistant professor, CS/ECE'}
          onChangeText={setTerms}
        />
        <FormField label="How often" hint="How long it waits between rounds.">
          <Segment
            label="How often"
            options={FREQUENCIES}
            value={schedule}
            onChange={setSchedule}
          />
        </FormField>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], paddingVertical: space[3] },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingVertical: space[3],
  },
  matchRight: { alignItems: 'flex-end', gap: space[1.5] },
})
