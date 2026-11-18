import { useEffect, useMemo, useState } from 'react'
import { TODAY } from '@/lib/today'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Feather } from '@react-native-vector-icons/feather/static'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { LabelChips, LabelPicker } from '@/components/common/Labels'
import { FiledPanel } from '@/components/common/FiledPanel'
import { FitPanel } from '@/components/applications/FitPanel'
import { ChecklistPanel } from '@/components/applications/ChecklistPanel'
import { TailoredPanel } from '@/components/applications/TailoredPanel'
import { StageDatesPanel } from '@/components/applications/StageDatesPanel'
import { StagePicker } from '@/components/common/StagePicker'
import { Button, IconButton } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmSheet } from '@/components/ui/ConfirmSheet'
import { EmptyState } from '@/components/ui/EmptyState'
import { MenuSheet } from '@/components/ui/Menu'
import { Screen } from '@/components/ui/Screen'
import { Divider, Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { NoteText } from '@/components/ui/NoteText'
import { useGraph } from '@jojo/service/react/kg-context'
import { ACTION_PHRASES } from '@jojo/service/core/domain-text'
import type { NodeId } from '@jojo/service/core/model'
import { STAGE_LABEL, displayName, offerDaysLeft } from '@jojo/service/data/seed'
import type { Application, Outcome, Stage } from '@jojo/service/data/seed'
import { bucketOf, compareItems, timeLabel } from '@jojo/service/data/timeline'
import type { TimelineBucket, TimelineItem } from '@jojo/service/data/timeline'
import { refKey } from '@/lib/ids'
import { stageNeedsDetails } from '@/lib/stage-transition'
import { hostOf } from '@/lib/urls'
import { useSheets } from '@/lib/sheets-context'
import { useApplications, useScout, useTimeline, useVault } from '@/lib/store-context'
import { useOrganisations } from '@jojo/service/react/use-organisations'
import type { TimelineDraft } from '@/lib/store-context'
import { KIND_ICON } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import type { RootStackParamList } from '@/navigation/types'
import { StageTransitionSheet } from '@/sheets/StageTransitionSheet'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { fonts, radius, space, type } from '@/theme/tokens'
import { useDomain } from '@/i18n/domain'
import { toTab } from '@/navigation/to-tab'
import { Icon } from '@/components/ui/Icon'

/**
 * One application, at its own address.
 *
 * Nine surfaces link to an application — the board card, the list row, the
 * recent list, a reminder's "related to", the search results — and until this
 * existed every one of them pointed at nothing.
 */
export function ApplicationDetailScreen() {
  const { t } = useTranslation('screens')
  const route = useRoute<RouteProp<RootStackParamList, 'ApplicationDetail'>>()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { get } = useApplications()
  const application = get(route.params.id)

  // The missing case first, because it is a real destination rather than an
  // error: a stale link, or the back button after a delete, both arrive here.
  if (!application) {
    return (
      <Screen title={t('detail.missing.title')}>
        <Panel>
          <EmptyState
            icon="help-circle"
            title={t('detail.missing.emptyTitle')}
            description={t('detail.missing.emptyDescription')}
            action={
              <Button
                label={t('detail.missing.back')}
                variant="outline"
                onPress={() =>
                  navigation.canGoBack() ? navigation.goBack() : toTab(navigation, 'Applications')
                }
              />
            }
          />
        </Panel>
      </Screen>
    )
  }

  // Keyed so the note draft belongs to one record. Without it, navigating
  // between two applications would carry the first one's unsaved note across.
  return <Detail key={application.id} application={application} />
}

function Detail({ application: a }: { application: Application }) {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const { byName: orgByName } = useOrganisations()
  const c = useColors()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const { toast } = useToast()
  const { open: openSheet } = useSheets()
  const { update, remove, duplicate, setNote: setNoteField } = useApplications()
  const graph = useGraph()
  const { forApplication, add: addItem, remove: removeItem } = useTimeline()
  const { links, files, snippets } = useVault()
  const { postings, matches } = useScout()

  const [note, setNote] = useState(a.note)
  const [noteSaved, setNoteSaved] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  /*
   * Off the node, not off the projection: `applicationFrom` drops the spans so
   * twenty of them do not ride into every board card and list row.
   */
  const noteFormat = graph.node(a.id as NodeId, 'application')?.props.noteFormat
  const [menuOpen, setMenuOpen] = useState(false)
  const [target, setTarget] = useState<Stage | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const labelKey = refKey('app', a.id)
  const items = useMemo(() => [...forApplication(a.id)].sort(compareItems), [forApplication, a.id])

  const openCount = items.filter((i) => !i.completedOn).length
  const reminderCount = items.filter((i) => i.remind).length
  // Two relations, counted separately because they no longer have the same
  // shape. Links, files and snippets carry a LIST — `FILED_UNDER` is
  // many-to-many, so one CV counts on every application it went to. Postings
  // and matches carry a scalar: `BECAME` is still one-to-one, because a lead
  // is promoted into exactly one application.
  const savedCount =
    [links, files, snippets].reduce(
      (n, list) => n + list.filter((r) => r.applicationIds.includes(a.id)).length,
      0,
    ) +
    [postings, matches].reduce(
      (n, list) => n + list.filter((r) => r.applicationId === a.id).length,
      0,
    )

  /**
   * What survives the delete, counted rather than guessed.
   *
   * `remove()` unlinks and never cascades, so the confirmation has to say so —
   * "delete Rice" cannot fairly be read as consent to delete the four files
   * someone spent an evening on.
   */
  const keptParts = [
    reminderCount > 0 ? t('detail.kept.reminders', { count: reminderCount }) : '',
    items.length - reminderCount > 0
      ? t('detail.kept.events', { count: items.length - reminderCount })
      : '',
    savedCount > 0 ? t('detail.kept.saved', { count: savedCount }) : '',
  ].filter(Boolean)
  const kept =
    keptParts.length <= 1
      ? (keptParts[0] ?? '')
      : t('shared.list', {
          items: keptParts.slice(0, -1).join(t('shared.separator')),
          last: keptParts.at(-1),
        })

  /**
   * The note's TEXT is plain, and the field here is too. Its formatting lives
   * in a sibling prop of offsets, which this screen renders and does not edit.
   *
   * Committed on blur rather than on every keystroke: a dispatch behind each
   * character would reset `daysAgo` while you typed.
   *
   * Through `setNote` with NO format argument, which is the whole reason the
   * phone is not second-class here: the tool then moves the existing spans onto
   * the new text rather than clearing them, so fixing a typo costs the
   * formatting on that word and nothing else.
   */
  /*
   * The draft follows the record whenever it is not being edited. It was set
   * once, at mount: a note saved from the edit sheet or by the assistant left
   * the pencil opening on the old text, and tapping away wrote that old text
   * back over the real note, with no undo.
   */
  useEffect(() => {
    if (!editingNote) setNote(a.note)
  }, [a.note, editingNote])

  const commitNote = () => {
    const next = note.trim()
    if (next === a.note) {
      setEditingNote(false)
      return
    }
    setNote(next)
    setNoteField(a.id, next)
    setNoteSaved(true)
    setEditingNote(false)
  }

  /**
   * Every write that changes the stage, and the only one that can undo itself.
   *
   * A stage move rewrites up to five fields in one go and can drop the offer the
   * user typed. Snapshotting first is what closes that gap: `a` is the record as
   * it stands this render, so the revert is a fact rather than a reconstruction,
   * and the minted timeline row goes back out with it.
   */
  const applyStageMove = (
    patch: Partial<Application>,
    extraItem?: TimelineDraft,
    consequences: string[] = [],
  ) => {
    const before = a
    const to = patch.stage ?? a.stage

    update(a.id, patch)
    const minted = extraItem ? addItem(extraItem) : undefined

    toast({
      title: t('rowActions.movedTitle', { name: displayName(a), stage: domain.stage(to) }),
      description: consequences.length > 0 ? consequences.join(' ') : undefined,
      action: {
        label: t('shared.undo'),
        onPress: () => {
          update(before.id, revertOf(before, patch))
          if (minted) removeItem(minted.id)
        },
      },
    })
  }

  const onPickStage = (stage: Stage) => {
    if (stageNeedsDetails(a, stage)) {
      setTarget(stage)
      return
    }
    applyStageMove({ stage, lastAction: `Moved to ${STAGE_LABEL[stage]}` })
  }

  const onDecide = (decision: Extract<Outcome, 'accepted' | 'declined'>) => {
    const before = a
    const patch: Partial<Application> = {
      stage: 'closed',
      outcome: decision,
      lastAction: decision === 'accepted' ? 'Offer accepted' : 'Offer declined',
    }
    update(a.id, patch)
    toast({
      title: t('detail.closedTitle', { name: displayName(a) }),
      description: t('detail.closedDescription', {
        outcome: t(`detail.outcomes.${decision}`),
      }),
      action: {
        label: t('shared.undo'),
        onPress: () => update(before.id, revertOf(before, patch)),
      },
    })
  }

  const onDuplicate = () => {
    const copy = duplicate(a.id)
    if (!copy) return
    toast({
      title: t('rowActions.duplicatedTitle', { name: displayName(copy) }),
      description: t('detail.duplicatedDescription'),
      action: {
        label: t('shared.undo'),
        onPress: () => {
          remove(copy.id)
          navigation.navigate('ApplicationDetail', { id: a.id })
        },
      },
    })
    navigation.navigate('ApplicationDetail', { id: copy.id })
  }

  const onDelete = () => {
    const { restore } = remove(a.id)
    // Both guards, because they catch different mistakes: the sheet catches the
    // mis-tap, the undo catches the change of mind. `restore` also puts back
    // every edge the delete unlinked, which the user could not rebuild by
    // simply adding the application again.
    toast({
      title: t('rowActions.deletedTitle', { name: displayName(a) }),
      description: kept ? t('detail.deletedKept', { kept }) : undefined,
      tone: 'danger',
      action: { label: t('shared.undo'), onPress: restore },
    })
    navigation.goBack()
  }

  const employer = orgByName(a.org)

  const facts: { id: string; label: string; value?: string; url?: string; go?: () => void }[] = [
    /*
     * The way in to the employer's own screen, and the only one there is.
     *
     * `organisation` has been a node since the graph existed and nothing linked
     * to it, so three roles at one university were three rows in a list with
     * nothing saying they belonged together. On the record rather than in the
     * title, because the title is the JOB and only half of it is the employer.
     */
    {
      id: 'employer',
      label: t('detail.facts.employer'),
      value: employer
        ? employer.applicationIds.length > 1
          ? t('detail.facts.employerJobs', {
              name: employer.name,
              count: employer.applicationIds.length,
            })
          : employer.name
        : a.org,
      ...(employer
        ? { go: () => navigation.navigate('Organisation', { key: employer.slug }) }
        : {}),
    },
    {
      id: 'source',
      label: t('detail.facts.source'),
      value: a.source === undefined ? undefined : domain.source(a.source),
    },
    { id: 'location', label: t('detail.facts.location'), value: a.location },
    // Falls through to the offer: Baylor states "$112k + $15k startup" in its
    // offer block, and printed "Compensation —" underneath it, because the
    // number was typed into the stage form and `a.comp` was never the field it
    // landed in.
    { id: 'comp', label: t('detail.facts.compensation'), value: a.comp ?? a.offer?.comp },
    {
      id: 'posting',
      label: t('detail.facts.posting'),
      value: a.url ? hostOf(a.url) : undefined,
      url: a.url,
    },
    // The same three the web record gained, for the same reason: each is typed
    // into a form and was stored without being shown anywhere.
    { id: 'postingId', label: t('detail.facts.postingId'), value: a.postingId },
    {
      id: 'appliedOn',
      label: t('detail.facts.appliedOn'),
      value: a.appliedOn ? domain.shortDate(a.appliedOn) : undefined,
    },
    // No 'Submitted on' row: it is the Submitted row of the stage dates just
    // below, where it can be corrected. Two copies of one date on one screen
    // invite the question of which is real, as the web's DetailFacts says.
    ...(a.confirmationRef !== undefined || a.stage !== 'draft'
      ? [
          {
            id: 'confirmationRef',
            label: t('detail.facts.confirmationRef'),
            value: a.confirmationRef,
          },
        ]
      : []),
    // An offer states its own outcome in the offer block; this is for the rest.
    ...(a.outcome !== undefined && a.offer === undefined
      ? [{ id: 'outcome', label: t('detail.facts.outcome'), value: domain.outcome(a.outcome) }]
      : []),
  ]

  return (
    <Screen
      title={displayName(a)}
      subtitle={`${domain.action(a.lastAction)} · ${
        a.daysAgo === 0 ? t('calendar.today') : t('today.recent.daysAgo', { count: a.daysAgo })
      }`}
      actions={
        <>
          <IconButton
            icon="flag"
            label={a.flagged ? t('applications.row.unflag') : t('applications.row.flag')}
            tone={a.flagged ? 'danger' : undefined}
            active={a.flagged}
            onPress={() =>
              update(a.id, {
                flagged: !a.flagged,
                lastAction: a.flagged ? ACTION_PHRASES.flagCleared : ACTION_PHRASES.flagged,
              })
            }
          />
          <IconButton
            icon="more-horizontal"
            label={t('detail.moreActions')}
            onPress={() => setMenuOpen(true)}
          />
        </>
      }
    >
      <Panel>
        <View style={s.chipRow}>
          {/* Neutral. The role is a category, not a status, and colour law
              spends colour on the user's own keywords — which sit on the row
              below and have to stay the loud thing. */}
          <Chip tone="gray">{a.roleTag}</Chip>
          <StagePicker value={a.stage} name={displayName(a)} onSelect={onPickStage} />
        </View>
        <View style={[s.chipRow, { marginTop: space[2.5] }]}>
          <LabelChips recordId={labelKey} />
          <LabelPicker recordId={labelKey} name={displayName(a)} />
        </View>
      </Panel>

      {/* Above the facts on purpose: a respond-by countdown is the most
          perishable thing on this screen, and the one you came to check.
          Rendered from the offer rather than from the stage, so the details the
          confirmation promised to keep survive the move to closed. */}
      {a.offer ? (
        <OfferBlock
          application={a}
          onDecide={onDecide}
          settled={a.stage === 'closed' ? (a.outcome ?? 'withdrawn') : undefined}
        />
      ) : null}

      <Panel>
        <PanelTitle>{t('detail.details')}</PanelTitle>
        <View style={{ gap: space[3] }}>
          {facts.map((f) => (
            <View key={f.id}>
              <Txt size="xs" tone="muted">
                {f.label}
              </Txt>
              {f.value === undefined ? (
                <Txt size="base" tone="muted">
                  —
                </Txt>
              ) : f.url ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityHint={t('detail.postingHint')}
                  /*
                   * Inside the app rather than out to the system browser, and
                   * the change is the whole feature rather than a preference.
                   *
                   * A posting is the one document in a search that belongs to
                   * somebody else and disappears on their schedule. Keeping a
                   * copy needs the page as the user sees it — signed in, and
                   * after its scripts have run — and the only context that has
                   * both is a browser the user is signed into. Safari and
                   * Chrome are such browsers and will not hand jojo the DOM;
                   * the WebView on `PostingBrowser` is one too, and does.
                   *
                   * So the tap that used to leave now arrives somewhere with a
                   * "Keep a copy" button in the corner. `Linking.openURL` is
                   * still what the vault's link rows use — this is the one
                   * address in the app that is worth archiving.
                   */
                  onPress={() =>
                    navigation.navigate('PostingBrowser', { url: f.url!, applicationId: a.id })
                  }
                  style={styles.linkRow}
                >
                  {/* A URL is one unbroken token, so it cannot wrap and will
                      not shrink on its own — the longest field in the app was
                      the one most able to run past the panel edge. */}
                  <Txt size="base" tone="info" style={s.fill} numberOfLines={1}>
                    {f.value}
                  </Txt>
                  <Feather name="globe" size={13} color={c.info} />
                </Pressable>
              ) : f.go ? (
                <Pressable accessibilityRole="link" onPress={f.go} style={styles.linkRow}>
                  <Txt size="base" tone="info" style={s.fill} numberOfLines={1}>
                    {f.value}
                  </Txt>
                  <Icon name="chevron-right" size={14} color={c.info} />
                </Pressable>
              ) : (
                <Txt size="base">{f.value}</Txt>
              )}
            </View>
          ))}
        </View>
      </Panel>

      {/* Under the facts, as on the web: when it reached each stage, and the
          place to correct a stamp that caught up with reality late. */}
      <StageDatesPanel application={a} />

      {/* Second, not last. The record's dates and the only Add button used to
          sit below an empty editor and its eight-button toolbar — so the one
          thing this screen is opened to check was the one you had to scroll for. */}
      <Panel>
        <PanelTitle
          hint={
            items.length > 0
              ? t('detail.dates.hint', { open: openCount, total: items.length })
              : undefined
          }
          right={
            <Button
              label={t('detail.dates.add')}
              icon="calendar"
              variant="outline"
              onPress={() =>
                // 'event' rather than 'reminder': this sits beside the record's
                // dates, so the date is the point. The sheet's own switch still
                // decides whether it also shows up as a reminder.
                openSheet('timelineItem', { mode: 'event', initial: { applicationId: a.id } })
              }
            />
          }
        >
          {/* Not "Upcoming": this list holds overdue and completed rows too, and
              a heading that promised the future while showing a thing you missed
              last week was the least trustworthy word on the screen. */}
          {t('detail.dates.title')}
        </PanelTitle>

        {items.length === 0 ? (
          <EmptyState
            compact
            title={t('detail.dates.emptyTitle')}
            description={t('detail.dates.emptyDescription')}
          />
        ) : (
          items.map((item, i) => (
            <View key={item.id}>
              {i > 0 ? <Divider /> : null}
              <UpcomingRow
                item={item}
                onEdit={() =>
                  openSheet('timelineItem', {
                    mode: item.remind ? 'reminder' : 'event',
                    initial: item,
                  })
                }
                onDraft={() => openSheet('draft', { itemId: item.id })}
              />
            </View>
          ))
        )}
      </Panel>

      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <PanelTitle style={{ flex: 1 }} hint={editingNote ? t('detail.note.hint') : undefined}>
            {t('detail.note.title')}
          </PanelTitle>
          {!editingNote && a.note !== '' ? (
            <IconButton
              icon="edit-2"
              label={t('detail.note.edit')}
              onPress={() => {
                setEditingNote(true)
              }}
            />
          ) : null}
        </View>

        {/* Read first, edit on request. The phone cannot draw a toolbar over a
            TextInput, so formatting is SHOWN here and changed on the web — and
            editing the words keeps the formatting on every word untouched,
            because the tool moves the spans rather than clearing them. */}
        {editingNote || a.note === '' ? (
          <>
            <TextInput
              multiline
              autoFocus={editingNote}
              value={note}
              onChangeText={(v) => {
                setNote(v)
                setNoteSaved(false)
              }}
              onBlur={commitNote}
              placeholder={t('detail.note.placeholder')}
              placeholderTextColor={c.text3}
              accessibilityLabel={t('detail.note.label', { name: displayName(a) })}
              style={[
                styles.note,
                { color: c.text1, backgroundColor: c.well, borderColor: c.hairline },
              ]}
            />
            {noteFormat !== undefined ? (
              <Txt size="xs" tone="muted" style={{ marginTop: space[1.5] }}>
                {t('detail.note.formatKept')}
              </Txt>
            ) : null}
          </>
        ) : (
          <NoteText note={a.note} format={noteFormat} />
        )}

        {noteSaved ? (
          <Txt size="xs" tone="muted" style={{ marginTop: space[1.5] }}>
            {t('detail.note.saved')}
          </Txt>
        ) : null}
      </Panel>

      {/* The question somebody opens a draft to answer — is this worth an
          evening — so it sits with the record rather than above it. */}
      <FitPanel applicationId={a.id} />

      {/* Directly under the verdict, because it is the verdict's next step. */}
      <TailoredPanel applicationId={a.id} />

      {/* Under the two cards it reads from: the verdict says whether to
          bother, the tailored materials are what you send, and this is what
          you have to go and get before you can send them. */}
      <ChecklistPanel applicationId={a.id} />

      <FiledPanel applicationId={a.id} />

      <MenuSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={displayName(a)}
        actions={[
          {
            id: 'edit',
            label: t('applications.row.edit'),
            icon: 'edit-2',
            onPress: () => openSheet('application', { mode: 'edit', id: a.id }),
          },
          {
            // The record's own way into a message. Until this existed the only
            // route to a filled thank-you was: add a reminder, open the Vault,
            // find its row, press Draft on it.
            id: 'draft',
            label: t('detail.draftMessage'),
            icon: 'mail',
            onPress: () => openSheet('draft', { applicationId: a.id }),
          },
          {
            id: 'duplicate',
            label: t('applications.row.duplicate'),
            icon: 'copy',
            onPress: onDuplicate,
          },
          {
            id: 'delete',
            label: t('shared.delete'),
            icon: 'trash-2',
            tone: 'danger',
            onPress: () => setConfirmDelete(true),
          },
        ]}
      />

      {target ? (
        <StageTransitionSheet
          open
          onOpenChange={(next) => {
            if (!next) setTarget(null)
          }}
          application={a}
          target={target}
          onApply={applyStageMove}
        />
      ) : null}

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('rowActions.confirmTitle', { name: displayName(a) })}
        description={
          kept ? t('detail.confirmDeleteKept', { kept }) : t('detail.confirmDeleteAlone')
        }
        confirmLabel={t('shared.delete')}
        tone="danger"
        onConfirm={onDelete}
      />
    </Screen>
  )
}

/* --------------------------------- offer --------------------------------- */

function OfferBlock({
  application: a,
  onDecide,
  settled,
}: {
  application: Application
  onDecide: (decision: 'accepted' | 'declined') => void
  /** Set once the record is closed — the block becomes a record of what happened. */
  settled?: Outcome
}) {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  const offer = a.offer!
  // Second argument required, and see the note in `lib/priority.ts`.
  const daysLeft = offerDaysLeft(offer, TODAY)
  const tone = settled ? 'muted' : daysLeft < 0 ? 'danger' : daysLeft <= 1 ? 'warning' : 'secondary'

  return (
    <Panel
      style={{
        borderColor: settled ? c.hairline : daysLeft < 0 ? c.dangerBorder : c.successBorder,
      }}
    >
      <PanelTitle
        hint={
          settled
            ? t('detail.offer.settled', { outcome: t(`detail.outcomes.${settled}`) })
            : daysLeft < 0
              ? t('detail.offer.pastDeadline', { count: -daysLeft })
              : t('detail.offer.daysLeft', { count: daysLeft })
        }
      >
        {t('detail.offer.title')}
      </PanelTitle>

      <Txt size="xl" weight="semibold" tone={tone}>
        {t('detail.offer.respondBy', { date: domain.shortDate(offer.respondBy) })}
      </Txt>
      {offer.comp ? (
        <Txt size="base" tone="secondary" style={{ marginTop: space[1] }}>
          {offer.comp}
        </Txt>
      ) : null}
      {offer.note ? (
        <Txt size="sm" tone="muted" style={{ marginTop: space[1] }}>
          {offer.note}
        </Txt>
      ) : null}

      {settled ? null : (
        <View style={styles.offerActions}>
          <Button
            label={t('detail.offer.accept')}
            icon="check"
            onPress={() => onDecide('accepted')}
          />
          <Button
            label={t('detail.offer.decline')}
            variant="outline"
            onPress={() => onDecide('declined')}
          />
        </View>
      )}
    </Panel>
  )
}

/* ------------------------------- date rows ------------------------------- */

/** The kinds a message is the obvious next move on. */
const DRAFTABLE: readonly TimelineItem['kind'][] = ['interview', 'follow-up', 'call', 'visit']

function UpcomingRow({
  item,
  onEdit,
  onDraft,
}: {
  item: TimelineItem
  onEdit: () => void
  onDraft: () => void
}) {
  const { t } = useTranslation('screens')
  const domain = useDomain()
  const c = useColors()
  const bucket = bucketOf(item, TODAY)
  const done = Boolean(item.completedOn)
  const draftable = !done && DRAFTABLE.includes(item.kind)

  const bucketTone: Record<TimelineBucket, 'danger' | 'warning' | 'muted'> = {
    overdue: 'danger',
    today: 'warning',
    upcoming: 'muted',
    done: 'muted',
  }

  return (
    <View style={styles.dateRow}>
      <Feather name={KIND_ICON[item.kind]} size={15} color={c.text3} style={{ marginTop: 3 }} />
      <Pressable accessibilityRole="button" onPress={onEdit} style={s.fill}>
        <Txt size="sm" tone={done ? 'muted' : 'primary'} style={done ? s.struck : undefined}>
          {item.title}
        </Txt>
        <Txt size="xs" tone="muted" numberOfLines={1}>
          {domain.kind(item.kind)}
          {item.detail ? ` · ${item.detail}` : ''}
        </Txt>
        {draftable ? (
          <Button
            label={t('detail.draftMessage')}
            icon="mail"
            variant="outline"
            onPress={onDraft}
            style={{ marginTop: space[1.5], alignSelf: 'flex-start' }}
          />
        ) : null}
      </Pressable>
      <View style={styles.dateRight}>
        <Txt size="xs" weight="medium" tone={bucketTone[bucket]}>
          {domain.when(item, TODAY)}
        </Txt>
        <Txt size="xs" tone="muted" mono>
          {timeLabel(item) ?? domain.shortDate(item.date)}
        </Txt>
      </View>
    </View>
  )
}

/**
 * The patch that puts `before` back, given the patch that changed it.
 *
 * Keyed off the patch rather than off a hand-written field list on purpose: the
 * stage form writes a different set of fields for each destination, and a list
 * here would be another place to remember when one of them grows a field.
 * `undefined` values count: `{ offer: undefined }` is how the form clears an
 * offer, and that is exactly the write that most needs undoing.
 */
function revertOf(before: Application, patch: Partial<Application>): Partial<Application> {
  const revert: Record<string, unknown> = { daysAgo: before.daysAgo }
  for (const key of Object.keys(patch)) revert[key] = before[key as keyof Application]
  return revert as Partial<Application>
}

const styles = StyleSheet.create({
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  offerActions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  dateRow: { flexDirection: 'row', gap: space[2.5], paddingVertical: space[2.5] },
  dateRight: { alignItems: 'flex-end', gap: 2 },
  note: {
    minHeight: 110,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space[3],
    fontFamily: fonts.regular,
    fontSize: type.base,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
})
