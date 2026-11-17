import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { fitOf } from '@jojo/service/core/fit'
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
// The parser is the shared one. `src/lib/draft-from.ts` held a 349-line copy of
// it that was never tested here; the two were checked input for input before it
// was deleted. `scout.posting.promote` parses a posting's URL through this same
// module with no screen in the call stack, so a second copy up here could only
// ever disagree with the store about what a pasted link means.
import { draftFromUrl } from '@jojo/service/core/parse-posting'
import { useProfile } from '@jojo/service/react/use-profile'
import { isAuto, kindOf } from '@jojo/service/react/use-pipelines'
import { usePipelinesState } from '@jojo/service/react/pipelines-context'
import { AUTO_CAPABLE, PIPELINE_SCHEDULES, scheduleOf } from '@jojo/service/core/proposal'
import type { PipelineKind } from '@jojo/service/core/model'
import { ProposalQueue } from '@/components/scout/ProposalQueue'
import { useApplications, useScout } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { displayUrl, hrefOf } from '@/lib/urls'
import type { RootStackParamList } from '@/navigation/types'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'
import { report } from '@/lib/analytics'
import { useDomain } from '@/i18n/domain'

/** Fit bands. A number alone doesn't say whether 64 is good. */
const fitTone = (fit: number) => (fit >= 80 ? 'green' : fit >= 60 ? 'amber' : 'gray')

/*
 * One list, in the shared layer. It was written out here and again in web's
 * PipelineDialog, with a `frequencyOf` on each side to cope with a stored value
 * that matched neither copy — `scheduleOf` is that function, once.
 */
// The labels are catalog keys, translated where they are drawn.
const KINDS = ['twin', 'scout'] as const

/** What a row's chip says. Four states, and each is a claim about the world. */
function statusOf(p: Pipeline, running: boolean, paused: boolean, t: TFunction<'screens'>) {
  if (!p.enabled)
    return { label: t('jobScout.status.off'), tone: 'gray' as const, dot: 'off' as const }
  if (paused)
    return { label: t('jobScout.status.paused'), tone: 'amber' as const, dot: 'warn' as const }
  if (running)
    return { label: t('jobScout.status.running'), tone: 'teal' as const, dot: 'on' as const }
  return { label: t('jobScout.status.watching'), tone: 'green' as const, dot: 'on' as const }
}

/** "a, b and c", in the reader's language. */
function joinList(parts: string[], t: TFunction<'screens'>) {
  if (parts.length <= 1) return parts[0] ?? ''
  return t('shared.list', {
    items: parts.slice(0, -1).join(t('shared.separator')),
    last: parts.at(-1),
  })
}

export function JobScoutScreen() {
  const { t } = useTranslation('screens')
  const domain = useDomain()
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

  /*
   * The engine is mounted above the navigator (`lib/pipelines.tsx`), not here.
   *
   * Calling `usePipelines` from this screen made a pipeline's lifetime the
   * screen's lifetime — and every exit from here pops it — so a pipeline
   * stopped the moment you left, under a footer promising it kept going.
   */
  const engine = usePipelinesState()

  const [editing, setEditing] = useState<Pipeline | 'new' | null>(null)
  const [onlyActive, setOnlyActive] = useState(false)
  const [url, setUrl] = useState('')

  const visiblePipelines = pipelines.filter((p) => !onlyActive || p.enabled)

  const savePipeline = (draft: PipelineDraft) => {
    if (editing && editing !== 'new') {
      updatePipeline(editing.id, draft)
      toast({ title: t('jobScout.toast.updated'), description: draft.name })
    } else {
      // Switched on: one that arrived off would read as a create that failed.
      // Whether it can run is the model's business, and the toast says which of
      // the two just happened rather than asserting the pessimistic one.
      const pipeline = addPipeline({ ...draft, enabled: true })
      toast({
        title: t('jobScout.toast.created'),
        description: engine.paused
          ? t('jobScout.toast.createdPaused', { name: pipeline.name })
          : t('jobScout.toast.createdRunning', { name: pipeline.name }),
      })
    }
    setEditing(null)
  }

  const onDeletePipeline = (p: Pipeline) => {
    const { restore } = removePipeline(p.id)
    toast({
      title: t('jobScout.toast.deleted'),
      description: t('jobScout.toast.deletedDescription', { name: p.name, source: p.source }),
      tone: 'danger',
      action: { label: t('shared.undo'), onPress: restore },
    })
  }

  /** Turns a match into a real application and goes straight to it. */
  const onPromote = (matchId: string) => {
    const application = promoteToApplication(matchId)
    if (!application) return
    toast({
      title: t('jobScout.toast.addedDraft', { org: application.org }),
      description: t('jobScout.toast.matchLinked'),
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
    toast({ title: t('jobScout.toast.postingSaved'), description: title })
  }

  const onPromotePosting = (postingId: string) => {
    const application = promotePosting(postingId)
    if (!application) return
    toast({
      title: t('jobScout.toast.addedDraft', { org: application.org }),
      description: t('jobScout.toast.postingLinked'),
    })
    navigation.navigate('ApplicationDetail', { id: application.id })
  }

  const onRemovePosting = (id: string, title: string) => {
    const { restore } = removePosting(id)
    toast({
      title: t('jobScout.toast.postingRemoved'),
      description: title,
      tone: 'danger',
      action: { label: t('shared.undo'), onPress: restore },
    })
  }

  return (
    <Screen
      title={t('jobScout.title')}
      subtitle={t('jobScout.subtitle')}
      actions={
        <Button label={t('applications.new')} icon="plus" onPress={() => setEditing('new')} />
      }
      options={
        <SettingRow
          label={t('jobScout.onlyActive')}
          description={t('jobScout.onlyActiveDescription')}
          control={
            <Toggle
              value={onlyActive}
              onValueChange={setOnlyActive}
              label={t('jobScout.onlyActive')}
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
            {t('jobScout.paused')}
          </Txt>
        </View>
      ) : null}

      <Panel>
        <PanelTitle hint={t('jobScout.pipelines.hint')}>{t('jobScout.pipelines.title')}</PanelTitle>

        {visiblePipelines.length === 0 ? (
          <EmptyState
            icon="radio"
            title={onlyActive ? t('jobScout.pipelines.noneOn') : t('jobScout.pipelines.none')}
            description={
              onlyActive
                ? t('jobScout.pipelines.noneOnDescription')
                : t('jobScout.pipelines.noneDescription')
            }
            action={
              onlyActive ? (
                <Button
                  label={t('jobScout.pipelines.showAll')}
                  variant="outline"
                  onPress={() => setOnlyActive(false)}
                />
              ) : (
                <Button
                  label={t('jobScout.editor.newTitle')}
                  icon="plus"
                  onPress={() => setEditing('new')}
                />
              )
            }
          />
        ) : (
          visiblePipelines.map((p, i) => {
            const isRunning = engine.running === p.id
            const state = statusOf(p, isRunning, engine.paused, t)
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
                        {t(`jobScout.kindLabel.${kind}`)}
                      </Chip>
                      <Chip tone={state.tone} size="sm">
                        {state.label}
                      </Chip>
                      {pending > 0 ? (
                        <Chip tone="teal" size="sm">
                          {t('jobScout.pipelines.toReview', { count: pending })}
                        </Chip>
                      ) : null}
                      {isAuto(p) ? (
                        <Chip tone="amber" size="sm">
                          {t('jobScout.pipelines.auto')}
                        </Chip>
                      ) : null}
                    </View>
                    {/* Auto is offered only where it exists. A scout never runs
                        unattended — see AUTO_CAPABLE — so a disabled switch
                        would advertise a setting that is not coming. */}
                    {AUTO_CAPABLE[kind] ? (
                      <View style={{ marginTop: space[2] }}>
                        <SettingRow
                          label={t('jobScout.pipelines.autoLabel')}
                          description={t('jobScout.pipelines.autoDescription')}
                          control={
                            <Toggle
                              value={isAuto(p)}
                              onValueChange={(auto) => engine.setAuto(p, auto)}
                              label={t('jobScout.pipelines.autoToggle', { name: p.name })}
                            />
                          }
                        />
                      </View>
                    ) : null}
                  </View>
                  <Toggle
                    value={p.enabled}
                    onValueChange={(enabled) => engine.setEnabled(p, enabled)}
                    label={t('jobScout.pipelines.enable', { name: p.name })}
                  />
                  <IconButton
                    icon="play"
                    label={t('jobScout.pipelines.runNow', { name: p.name })}
                    disabled={engine.paused || engine.running !== null}
                    onPress={() => {
                      engine.runNow(p.id)
                      void report('scout_pipeline_started', { kind: kindOf(p) })
                    }}
                  />
                  <IconButton
                    icon="edit-2"
                    label={t('jobScout.pipelines.edit', { name: p.name })}
                    onPress={() => setEditing(p)}
                  />
                  <IconButton
                    icon="trash-2"
                    tone="danger"
                    label={t('jobScout.pipelines.delete', { name: p.name })}
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
        onApprove={(id) => {
          void report('scout_proposal_decided', { decision: 'approved' })
          return engine.approve(id)
        }}
        onDiscard={(id) => {
          void report('scout_proposal_decided', { decision: 'declined' })
          return engine.discard(id)
        }}
        onSweep={engine.sweep}
        onClearAll={engine.clearAll}
      />

      <Panel>
        {/* The hint used to read "example scores", because the percentages were
            fixtures. They are computed now — against the match terms, target
            roles and regions on your profile — so the hint says what they are
            measured against rather than apologising for them. */}
        <PanelTitle hint={t('jobScout.matches.hint')}>{t('jobScout.matches.title')}</PanelTitle>

        {matches.length === 0 ? (
          <EmptyState
            icon="radio"
            title={t('jobScout.matches.emptyTitle')}
            description={t('jobScout.matches.emptyDescription')}
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
                        {t('jobScout.matches.matched', {
                          terms: joinList(fit.matched.slice(0, 3), t),
                        })}
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
                          {t('jobScout.inApplications', { name: displayName(application) })}
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
                        {t('jobScout.matches.notScored')}
                      </Chip>
                    ) : (
                      <Chip tone={fitTone(fit.score)} size="sm">
                        {t('search.fit', { fit: fit.score })}
                      </Chip>
                    )}
                    {/* Promoting links the two rather than moving the match: the
                        feed is generated, so a mis-tap on a row that vanished
                        could not be undone. */}
                    {application ? (
                      <Chip tone="teal" size="sm">
                        {t('jobScout.matches.added')}
                      </Chip>
                    ) : (
                      <Button
                        label={t('profile.add')}
                        variant="outline"
                        onPress={() => onPromote(m.id)}
                      />
                    )}
                  </View>
                </View>
              </View>
            )
          })
        )}
      </Panel>

      <Panel>
        <PanelTitle hint={t('jobScout.save.hint')}>{t('jobScout.save.title')}</PanelTitle>
        <Txt size="sm" tone="secondary" style={{ marginBottom: space[3] }}>
          {t('jobScout.save.description')}
        </Txt>

        <View style={{ gap: space[2] }}>
          <SearchInput
            label={t('jobScout.save.urlLabel')}
            value={url}
            onChange={setUrl}
            placeholder="https://university.edu/careers/…"
          />
          <Button
            label={t('jobScout.save.button')}
            size="md"
            blocker={url.trim() ? undefined : t('jobScout.save.blocker')}
            onPress={onSavePosting}
          />
        </View>

        <View style={{ marginTop: space[4] }}>
          {postings.length === 0 ? (
            <EmptyState
              icon="external-link"
              title={t('jobScout.save.emptyTitle')}
              description={t('jobScout.save.emptyDescription')}
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
                        {t('jobScout.save.meta', {
                          url: displayUrl(p.url),
                          ago: domain.ago(p.savedOn, TODAY),
                        })}
                      </Txt>
                      {application ? (
                        <Txt size="xs" tone="info" style={{ marginTop: space[1] }}>
                          {t('jobScout.inApplications', { name: displayName(application) })}
                        </Txt>
                      ) : null}
                      <View style={{ marginTop: space[1.5] }}>
                        <Chip tone={p.linked ? 'teal' : 'gray'} size="sm">
                          {p.linked ? t('jobScout.save.linked') : t('jobScout.save.unscored')}
                        </Chip>
                      </View>
                    </Pressable>
                    <View style={styles.matchRight}>
                      {p.linked ? null : (
                        <Button
                          label={t('profile.add')}
                          variant="outline"
                          onPress={() => onPromotePosting(p.id)}
                        />
                      )}
                      <IconButton
                        icon="trash-2"
                        tone="danger"
                        label={t('profile.remove', { name: p.title })}
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
        {t('jobScout.footer')}
      </Txt>

      {/*
       * Asked when a pipeline has run twice with nothing to show for it.
       * "Keep it running" is not a no-op — it resets the idle counter, so the
       * question cannot come straight back on the next round.
       */}
      <Sheet
        open={engine.shutdownOffer !== null}
        onClose={engine.dismissShutdown}
        title={t('jobScout.shutdown.title', { name: engine.shutdownOffer?.name ?? '' })}
        description={t('jobScout.shutdown.description')}
        footer={
          <>
            <Button
              label={t('jobScout.shutdown.keep')}
              variant="ghost"
              size="md"
              onPress={engine.dismissShutdown}
            />
            <Button label={t('jobScout.shutdown.off')} size="md" onPress={engine.acceptShutdown} />
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
  const { t } = useTranslation('screens')
  const kinds = KINDS.map((value) => ({ value, label: t(`jobScout.kinds.${value}`) }))
  const frequencies = PIPELINE_SCHEDULES.map((value) => ({
    value,
    label: t(`jobScout.schedules.${value}`),
  }))
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
      title={initial ? t('jobScout.editor.editTitle') : t('jobScout.editor.newTitle')}
      description={t('jobScout.editor.description')}
      footer={
        <>
          <Button label={t('shared.cancel')} variant="ghost" size="md" onPress={onClose} />
          <Button
            label={initial ? t('profile.save') : t('jobScout.editor.create')}
            size="md"
            onPress={submit}
          />
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
            label={t('jobScout.editor.kind')}
            hint={
              kind === 'twin'
                ? t('jobScout.editor.kindTwinHint')
                : t('jobScout.editor.kindScoutHint')
            }
          >
            <Segment
              label={t('jobScout.editor.kind')}
              options={kinds}
              value={kind}
              onChange={setKind}
            />
          </FormField>
        )}
        <TextField
          label={t('jobScout.editor.name')}
          required
          value={name}
          error={attempted && !name.trim() ? t('jobScout.editor.nameError') : undefined}
          placeholder={
            kind === 'twin'
              ? t('jobScout.editor.namePlaceholderTwin')
              : t('jobScout.editor.namePlaceholderScout')
          }
          onChangeText={setName}
        />
        {needsSource ? (
          <TextField
            label={t('jobScout.editor.sources')}
            required
            mono
            autoCapitalize="none"
            value={source}
            error={attempted && !source.trim() ? t('jobScout.editor.sourcesError') : undefined}
            hint={t('jobScout.editor.sourcesHint')}
            placeholder="cra.org/ads"
            onChangeText={setSource}
          />
        ) : null}
        <TextField
          label={kind === 'twin' ? t('jobScout.editor.focus') : t('profile.interests.matchTerms')}
          value={terms}
          hint={kind === 'twin' ? t('jobScout.editor.focusHint') : t('jobScout.editor.termsHint')}
          placeholder={
            kind === 'twin'
              ? t('jobScout.editor.focusPlaceholder')
              : t('jobScout.editor.termsPlaceholder')
          }
          onChangeText={setTerms}
        />
        <FormField label={t('jobScout.editor.often')} hint={t('jobScout.editor.oftenHint')}>
          <Segment
            label={t('jobScout.editor.often')}
            options={frequencies}
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
