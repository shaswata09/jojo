import { useState } from 'react'
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
import { draftFromUrl } from '@/lib/draft-from'
import { useProfile } from '@jojo/service/react/use-profile'
import { useApplications, useScout } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { displayUrl, hrefOf } from '@/lib/urls'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/** Fit bands. A number alone doesn't say whether 64 is good. */
const fitTone = (fit: number) => (fit >= 80 ? 'green' : fit >= 60 ? 'amber' : 'gray')

const FREQUENCIES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
] as const

type Frequency = (typeof FREQUENCIES)[number]['value']

const frequencyOf = (schedule: string): Frequency =>
  FREQUENCIES.some((f) => f.value === schedule) ? (schedule as Frequency) : 'daily'

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

  const [editing, setEditing] = useState<Pipeline | 'new' | null>(null)
  const [onlyActive, setOnlyActive] = useState(false)
  const [url, setUrl] = useState('')

  const visiblePipelines = pipelines.filter((p) => !onlyActive || p.enabled)

  const savePipeline = (draft: Omit<Pipeline, 'id' | 'enabled'>) => {
    if (editing && editing !== 'new') {
      updatePipeline(editing.id, draft)
      toast({ title: 'Pipeline updated', description: draft.name })
    } else {
      // Switched on, and the banner above already says why nothing runs. A new
      // pipeline that arrived off would read as a create that failed.
      const pipeline = addPipeline({ ...draft, enabled: true })
      toast({
        title: 'Pipeline created',
        description: `${pipeline.name} — paused until a model is connected.`,
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
      {/* System status, stated plainly rather than implied by a colour. */}
      <View
        accessibilityRole="alert"
        style={[s.banner, { backgroundColor: c.warningSoft, borderColor: c.warningBorder }]}
      >
        <Txt size="sm" tone="warning">
          No local model is connected, so matching is paused. You can still write pipelines and save
          postings below — both are scored once a model is reachable.
        </Txt>
      </View>

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
          visiblePipelines.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <View style={{ marginTop: 5 }}>
                  <StatusDot status={p.enabled ? 'warn' : 'off'} />
                </View>
                <View style={s.fill}>
                  <Txt size="sm" weight="medium">
                    {p.name}
                  </Txt>
                  <Txt size="xs" tone="muted" mono numberOfLines={2}>
                    {p.source} · {p.schedule} · {p.filter}
                  </Txt>
                  <View style={{ marginTop: space[1.5], flexDirection: 'row', gap: space[1.5] }}>
                    <Chip tone={p.enabled ? 'amber' : 'gray'} size="sm">
                      {p.enabled ? 'paused' : 'off'}
                    </Chip>
                  </View>
                </View>
                <Toggle
                  value={p.enabled}
                  onValueChange={(enabled) => updatePipeline(p.id, { enabled })}
                  label={`Enable ${p.name}`}
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
          ))
        )}
      </Panel>

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
        Pipelines would run on your device. Nothing is sent to a third party.
      </Txt>

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

function PipelineEditor({
  initial,
  onClose,
  onSave,
}: {
  initial?: Pipeline
  onClose: () => void
  onSave: (draft: Omit<Pipeline, 'id' | 'enabled'>) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [terms, setTerms] = useState(initial?.filter === '—' ? '' : (initial?.filter ?? ''))
  const [schedule, setSchedule] = useState<Frequency>(frequencyOf(initial?.schedule ?? 'daily'))
  // Raised by a save attempt rather than by typing, so an untouched field is not
  // marked wrong before anyone has reached it.
  const [attempted, setAttempted] = useState(false)

  const submit = () => {
    setAttempted(true)
    if (!name.trim() || !source.trim()) return
    onSave({
      name: name.trim(),
      source: source.trim(),
      schedule,
      // The seed writes an em dash for a pipeline that filters nothing, and the
      // row prints this field verbatim — an empty string would leave a dangling
      // separator in the middle of the line.
      filter: terms.trim() || '—',
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={initial ? 'Edit pipeline' : 'New pipeline'}
      description="A pipeline is a saved search: where to look, what to look for, and how often. Matching itself waits on a local model, so a new one is created paused."
      footer={
        <>
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
          <Button label={initial ? 'Save' : 'Create'} size="md" onPress={submit} />
        </>
      }
    >
      <View style={{ gap: space[3.5], paddingBottom: space[2] }}>
        <TextField
          label="Name"
          required
          value={name}
          error={attempted && !name.trim() ? 'Name it after what it watches.' : undefined}
          placeholder="e.g. CRA faculty job board"
          onChangeText={setName}
        />
        <TextField
          label="Sources"
          required
          mono
          autoCapitalize="none"
          value={source}
          error={
            attempted && !source.trim()
              ? 'A pipeline with no source has nothing to read.'
              : undefined
          }
          hint="The board or careers page it reads. Separate several with commas."
          placeholder="cra.org/ads"
          onChangeText={setSource}
        />
        <TextField
          label="Match terms"
          value={terms}
          hint="What a posting is scored against. Leave blank to keep everything the source lists."
          placeholder="assistant professor, CS/ECE"
          onChangeText={setTerms}
        />
        <FormField label="Frequency" hint="How often it would run once a model is reachable.">
          <Segment
            label="Frequency"
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
